import { describe, it, expect } from 'vitest';
import { reconcileAgenda, emptyAgenda, activeGoals, agendaPriority, agendaLines, epochBefore, type Agenda } from './agenda.js';

type Need = { slot: string; missing: number };
const need = (slot: string, missing = 1) => ({ id: `repair:${slot}`, kind: 'repair', data: { slot, missing } });
const t = (n: number) => new Date(Date.UTC(2026, 9, 7, 12, n)).toISOString();

describe('reconcileAgenda', () => {
  it('opens goals from needs, in order, and keeps them stable across repeated observations', () => {
    const first = reconcileAgenda<Need>(emptyAgenda(), { at: t(0), taskId: 'task-1', needs: [need('RB'), need('WR')], epoch: 5 });
    expect(activeGoals(first).map((g) => g.id)).toEqual(['repair:RB', 'repair:WR']);
    expect(first.epoch).toBe('5');
    const again = reconcileAgenda(first, { at: t(1), taskId: 'task-2', needs: [need('WR'), need('RB')], epoch: 5 });
    // Still-relevant goals keep their place; the same need creates nothing new.
    expect(activeGoals(again).map((g) => g.id)).toEqual(['repair:RB', 'repair:WR']);
    expect(activeGoals(again)[0]).toBe(activeGoals(first)[0]);
    expect(again.goals).toHaveLength(2);
  });

  it('completes a goal when its need stops being reported, and reopens the same id later', () => {
    let a = reconcileAgenda<Need>(emptyAgenda(), { at: t(0), taskId: 't1', needs: [need('RB')], epoch: 5 });
    a = reconcileAgenda(a, { at: t(1), taskId: 't2', needs: [], epoch: 5 });
    expect(a.goals[0]).toMatchObject({ id: 'repair:RB', status: 'completed', sourceTaskId: 't2' });
    a = reconcileAgenda(a, { at: t(2), taskId: 't3', needs: [need('RB')], epoch: 5 });
    expect(activeGoals(a)[0]).toMatchObject({ id: 'repair:RB', status: 'active', createdAt: t(0), updatedAt: t(2) });
    expect(a.goals).toHaveLength(1);
  });

  it('replaces data when a need changed, keeping createdAt', () => {
    let a = reconcileAgenda<Need>(emptyAgenda(), { at: t(0), taskId: 't1', needs: [need('RB', 1)] });
    a = reconcileAgenda(a, { at: t(1), taskId: 't2', needs: [need('RB', 2)] });
    expect(activeGoals(a)[0]).toMatchObject({ data: { slot: 'RB', missing: 2 }, createdAt: t(0), updatedAt: t(1), sourceTaskId: 't2' });
  });

  it('rejects stale observations: older times and earlier epochs', () => {
    const a = reconcileAgenda<Need>(emptyAgenda(), { at: t(5), taskId: 't1', needs: [need('RB')], epoch: 5 });
    expect(reconcileAgenda(a, { at: t(4), taskId: 't2', needs: [], epoch: 5 })).toBe(a);
    expect(reconcileAgenda(a, { at: t(6), taskId: 't2', needs: [], epoch: 4 })).toBe(a);
    expect(reconcileAgenda(a, { at: t(6), taskId: 't2', needs: [], epoch: 6 })).not.toBe(a);
  });

  it('expires the old epoch’s goals on a new epoch', () => {
    let a = reconcileAgenda<Need>(emptyAgenda(), { at: t(0), taskId: 't1', needs: [need('RB')], epoch: 5 });
    a = reconcileAgenda(a, { at: t(1), taskId: 't2', needs: [need('RB')], epoch: 6 });
    expect(a.goals.map((g) => [g.id, g.status, g.epoch])).toEqual([
      ['repair:RB', 'active', '6'],
      ['repair:RB', 'expired', '5'],
    ]);
    // The new epoch's goal is a fresh one, not the old one carried over.
    expect(activeGoals(a)[0]?.createdAt).toBe(t(1));
    // And the old one stays expired on the next observation.
    a = reconcileAgenda(a, { at: t(2), taskId: 't3', needs: [need('RB')], epoch: 6 });
    expect(a.goals.map((g) => g.status)).toEqual(['active', 'expired']);
  });

  it('cancels everything and closes; a closed agenda ignores observations', () => {
    let a = reconcileAgenda<Need>(emptyAgenda(), { at: t(0), taskId: 't1', needs: [need('RB')] });
    a = reconcileAgenda(a, { at: t(1), taskId: 't2', needs: [need('RB')], closed: true });
    expect(a.closed).toBe(true);
    expect(a.goals[0]?.status).toBe('cancelled');
    expect(reconcileAgenda(a, { at: t(2), taskId: 't3', needs: [need('WR')] })).toBe(a);
  });

  it('bounds active goals and history', () => {
    let a: Agenda<Need> = emptyAgenda();
    a = reconcileAgenda(a, { at: t(0), taskId: 't', needs: ['A', 'B', 'C', 'D', 'E'].map((s) => need(s)) }, { active: 2, history: 3 });
    expect(activeGoals(a).map((g) => g.data.slot)).toEqual(['A', 'B']);
    for (let i = 1; i <= 6; i++) a = reconcileAgenda(a, { at: t(i), taskId: 't', needs: [need(`N${i}`)] }, { active: 2, history: 3 });
    expect(a.goals.filter((g) => g.status !== 'active')).toHaveLength(3);
    expect(a.goals.filter((g) => g.status !== 'active')[0]?.updatedAt).toBe(t(6));
  });

  it('prioritizes options that serve a goal, and renders prompt lines', () => {
    const a = reconcileAgenda<Need>(emptyAgenda(), { at: t(0), taskId: 't', needs: [need('RB'), need('WR')] });
    expect(agendaPriority(a, (g) => g.data.slot === 'WR')).toBe(2);
    expect(agendaPriority(a, (g) => g.data.slot === 'RB')).toBe(3);
    expect(agendaPriority(a, () => false)).toBe(0);
    expect(agendaPriority(null, () => true)).toBe(0);
    expect(agendaLines(a, (g) => `Need ${g.data.missing} ${g.data.slot}`)).toEqual([
      `[repair:RB] Need 1 RB (pursuing since ${t(0)})`,
      `[repair:WR] Need 1 WR (pursuing since ${t(0)})`,
    ]);
  });

  it('orders epochs numerically when both are numbers, else lexically', () => {
    expect(epochBefore('9', '10')).toBe(true);
    expect(epochBefore('2026-01-02', '2026-01-10')).toBe(true);
    expect(epochBefore('b', 'a')).toBe(false);
  });
});
