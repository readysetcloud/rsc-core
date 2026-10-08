import { describe, it, expect } from 'vitest';
import { openCommitment, advanceCommitment, expireCommitments, dueCommitments, openCommitments, emptyCommitments, currentTask, COMMITMENT_LIMITS, type CommitmentBook } from './commitments.js';

type Intent = { give: string[]; get: string[] };
const t = (h: number) => new Date(Date.UTC(2026, 9, 7, h)).toISOString();
const draft = (over: Partial<Parameters<typeof openCommitment<Intent>>[1]> = {}) => ({
  kind: 'trade_interest',
  at: t(0),
  taskId: 'look-1',
  counterpart: 'team-2',
  source: { channel: 'dm-1', ref: 'msg-1', visibility: 'private' as const },
  intent: { give: ['p1'], get: ['p2'] },
  expiresAt: t(96),
  ...over,
});

describe('openCommitment', () => {
  it('records a queued commitment keyed by its source', () => {
    const { book, outcome, commitment } = openCommitment<Intent>(emptyCommitments(), draft());
    expect(outcome).toBe('created');
    expect(commitment).toMatchObject({ id: 'trade_interest:msg-1', status: 'queued', childTaskIds: ['look-1'], counterpart: 'team-2' });
    expect(openCommitments(book)).toHaveLength(1);
  });

  it('is idempotent per source, detects duplicates per counterpart, and enforces limits', () => {
    const first = openCommitment<Intent>(emptyCommitments(), draft());
    expect(openCommitment(first.book, draft({ taskId: 'look-9' })).outcome).toBe('existing');
    expect(openCommitment(first.book, draft({ source: { channel: 'dm-1', ref: 'msg-2', visibility: 'private' } })).outcome).toBe('duplicate');
    expect(openCommitment(first.book, draft({ source: { channel: 'dm-1', ref: 'msg-3', visibility: 'private' }, intent: { give: ['p9'], get: ['p2'] } })).outcome).toBe('limit');
    expect(openCommitment(first.book, draft({ counterpart: 'team-3', source: { channel: 'dm-2', ref: 'msg-4', visibility: 'private' } })).outcome).toBe('created');
    expect(openCommitment(emptyCommitments(), draft({ expiresAt: t(0) })).outcome).toBe('invalid');
    expect(openCommitment(emptyCommitments(), draft({ counterpart: '' })).outcome).toBe('invalid');
  });
});

describe('advanceCommitment', () => {
  const opened = () => openCommitment<Intent>(emptyCommitments(), draft()).book;

  it('walks start → waiting → settle, only for the assigned task', () => {
    let book = opened();
    expect(advanceCommitment(book, 'trade_interest:msg-1', { type: 'start', taskId: 'other' }, t(1)).applied).toBe(false);
    let r = advanceCommitment(book, 'trade_interest:msg-1', { type: 'start', taskId: 'look-1' }, t(1));
    expect(r.applied).toBe(true);
    expect(r.commitment?.status).toBe('evaluating');
    r = advanceCommitment(r.book, 'trade_interest:msg-1', { type: 'waiting', taskId: 'look-1', externalRef: 'trade-7', reason: 'offer_sent', facts: { score: 1 } }, t(2));
    expect(r.commitment).toMatchObject({ status: 'waiting_on_counterpart', externalRef: 'trade-7', decision: { reason: 'offer_sent', facts: { score: 1 } } });
    r = advanceCommitment(r.book, 'trade_interest:msg-1', { type: 'settle', status: 'fulfilled', reason: 'accepted' }, t(3));
    expect(r.commitment?.status).toBe('fulfilled');
    expect(openCommitments(r.book)).toHaveLength(0);
    // Settled: no second result.
    expect(advanceCommitment(r.book, 'trade_interest:msg-1', { type: 'closed', taskId: 'look-1', status: 'declined', reason: 'x' }, t(4)).applied).toBe(false);
    expect(advanceCommitment(r.book, 'nope', { type: 'start', taskId: 'look-1' }, t(4))).toMatchObject({ applied: false, commitment: null });
  });

  it('schedules a reconsideration only for a decline marked reconsiderable, within the deadline', () => {
    const book = opened();
    const plain = advanceCommitment(book, 'trade_interest:msg-1', { type: 'closed', taskId: 'look-1', status: 'declined', reason: 'lopsided' }, t(1));
    expect(plain.commitment?.nextReviewAt).toBeNull();
    const again = advanceCommitment(book, 'trade_interest:msg-1', { type: 'closed', taskId: 'look-1', status: 'declined', reason: 'value_below_floor', reconsider: true }, t(1));
    expect(again.commitment?.nextReviewAt).toBe(t(13));
    const late = advanceCommitment(book, 'trade_interest:msg-1', { type: 'closed', taskId: 'look-1', status: 'declined', reason: 'value_below_floor', reconsider: true }, t(90));
    expect(late.commitment?.nextReviewAt).toBeNull();
  });

  it('redispatches a stale queued look (resume) and a due decline (reconsider), bounded', () => {
    let book = opened();
    expect(advanceCommitment(book, 'trade_interest:msg-1', { type: 'redispatch', taskId: 'look-2', mode: 'resume' }, t(0.5)).applied).toBe(false);
    let r = advanceCommitment(book, 'trade_interest:msg-1', { type: 'redispatch', taskId: 'look-2', mode: 'resume' }, t(2));
    expect(r.commitment).toMatchObject({ status: 'queued', childTaskIds: ['look-1', 'look-2'], reconsiderations: 0 });
    expect(currentTask(r.commitment!)).toBe('look-2');
    book = advanceCommitment(r.book, 'trade_interest:msg-1', { type: 'closed', taskId: 'look-2', status: 'declined', reason: 'value_below_floor', reconsider: true }, t(3)).book;
    expect(advanceCommitment(book, 'trade_interest:msg-1', { type: 'redispatch', taskId: 'look-3', mode: 'reconsider' }, t(10)).applied).toBe(false);
    r = advanceCommitment(book, 'trade_interest:msg-1', { type: 'redispatch', taskId: 'look-3', mode: 'reconsider' }, t(16));
    expect(r.commitment).toMatchObject({ status: 'queued', reconsiderations: 1, nextReviewAt: null, decision: { reason: 'value_below_floor' } });
    // Once only.
    book = advanceCommitment(r.book, 'trade_interest:msg-1', { type: 'closed', taskId: 'look-3', status: 'declined', reason: 'value_below_floor', reconsider: true }, t(17)).book;
    expect(book.commitments[0]?.nextReviewAt).toBeNull();
  });

  it('expires looks never taken, not work waiting on the counterpart', () => {
    let book = opened();
    book = openCommitment(book, draft({ counterpart: 'team-3', source: { channel: 'dm-2', ref: 'msg-2', visibility: 'private' }, taskId: 'look-b' })).book;
    book = advanceCommitment(book, 'trade_interest:msg-2', { type: 'waiting', taskId: 'look-b', externalRef: 'trade-1' }, t(1)).book;
    const { book: next, expired } = expireCommitments(book, t(100));
    expect(expired.map((c) => c.id)).toEqual(['trade_interest:msg-1']);
    expect(next.commitments.find((c) => c.id === 'trade_interest:msg-1')).toMatchObject({ status: 'expired', decision: { reason: 'deadline_passed' } });
    expect(next.commitments.find((c) => c.id === 'trade_interest:msg-2')?.status).toBe('waiting_on_counterpart');
  });

  it('finds due work for a check-in', () => {
    let book = opened();
    book = openCommitment(book, draft({ counterpart: 'team-3', source: { channel: 'dm-2', ref: 'msg-2', visibility: 'private' }, taskId: 'look-b' })).book;
    book = advanceCommitment(book, 'trade_interest:msg-2', { type: 'closed', taskId: 'look-b', status: 'declined', reason: 'value_below_floor', reconsider: true }, t(1)).book;
    const due = dueCommitments(book, t(14), (c) => c.id === 'trade_interest:msg-2');
    expect(due.resume.map((c) => c.id)).toEqual(['trade_interest:msg-1']);
    expect(due.reconsider.map((c) => c.id)).toEqual(['trade_interest:msg-2']);
    expect(dueCommitments(book, t(14)).reconsider).toEqual([]);
    expect(dueCommitments(book, t(0.5)).resume).toEqual([]);
  });

  it('keeps bounded history', () => {
    let book: CommitmentBook<Intent> = emptyCommitments();
    for (let i = 0; i < COMMITMENT_LIMITS.history + 3; i++) {
      const id = `trade_interest:m${i}`;
      book = openCommitment(book, draft({ source: { channel: 'c', ref: `m${i}`, visibility: 'shared' }, taskId: `l${i}`, intent: { give: [`p${i}`], get: [] } })).book;
      book = advanceCommitment(book, id, { type: 'closed', taskId: `l${i}`, status: 'cancelled', reason: 'x' }, t(i + 1)).book;
    }
    expect(book.commitments).toHaveLength(COMMITMENT_LIMITS.history);
    expect(book.commitments[0]?.id).toBe(`trade_interest:m${COMMITMENT_LIMITS.history + 2}`);
  });
});
