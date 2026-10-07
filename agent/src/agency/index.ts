// @readysetcloud/agent/agency — the primitives that make an agent feel like it
// has agency: it is woken by triggers it paces itself against, it pursues
// durable goals it reconciles from observed state, it keeps the promises it
// makes, and it checks in on its own. Strands-free: Lambdas can import this
// subpath without bundling the agent runtime.
//
// The pieces compose; none requires the others:
//
//   persistent      definePersistentAgent: the fourth agent type, built from the
//                   pieces below and run in YOUR stack (a build tool, not a
//                   hosted service): route(event) + handleTask(detail)
//   triggers        events → "Run Agent Task" requests, through atomic gates
//                   (cooldowns, once-per keys) with human-like delays
//   agenda          typed goals reconciled from observations, bounded, idempotent
//   commitments     typed promises with an explicit lifecycle and reconsideration
//   check-in        the scheduled heartbeat that makes an agent act unprompted
//   state-store     a revision-checked DynamoDB document per agent for the above
//   response-delay  the seeded, deadline-aware wait behind the delays
//   random          seeded rolls, so a replay never changes an agent's mind

export { hashString, seededRandom, seededRoll } from './random.js';

export {
  responseDelay,
  deadlineLimitMs,
  RESPONSE_DELAY_PROFILES,
  IMMEDIATE_RESPONSE,
  TYPICAL_RESPONSE,
  type ResponseDelay,
  type ResponseDelayInput,
  type ResponseDelayLever,
  type ResponseDelayProfile,
  type ResponseDelayProfileName,
} from './response-delay.js';

export {
  reconcileAgenda,
  activeGoals,
  agendaPriority,
  agendaLines,
  emptyAgenda,
  epochBefore,
  AGENDA_LIMITS,
  AGENDA_STATUSES,
  type Agenda,
  type AgendaGoal,
  type AgendaGoalStatus,
  type AgendaLimits,
  type AgendaNeed,
  type AgendaObservation,
} from './agenda.js';

export {
  openCommitment,
  advanceCommitment,
  expireCommitments,
  dueCommitments,
  openCommitments,
  isOpenCommitment,
  currentTask,
  emptyCommitments,
  COMMITMENT_LIMITS,
  COMMITMENT_STATUSES,
  type Commitment,
  type CommitmentBook,
  type CommitmentDecision,
  type CommitmentDraft,
  type CommitmentEvent,
  type CommitmentLimits,
  type CommitmentStatus,
  type OpenOutcome,
} from './commitments.js';

export {
  checkInMoment,
  nextCheckIn,
  zonedDate,
  zonedParts,
  zonedTimeToUtc,
  DEFAULT_CHECK_IN_SCHEDULE,
  type CheckInMoment,
  type CheckInSchedule,
} from './check-in.js';

export {
  readAgentState,
  updateAgentState,
  AGENT_STATE_ENTITY,
  type AgentStateKey,
  type AgentStateRecord,
  type UpdateAgentStateOptions,
} from './state-store.js';

export {
  routeTrigger,
  humanDelay,
  taskIdFor,
  cooldownSlot,
  gateCutoff,
  dynamoTriggerGates,
  memoryTriggerGates,
  eventBridgeDispatcher,
  type AgentPacing,
  type EventBridgeDispatcherOptions,
  type RuleAgentInput,
  type RuleDelayInput,
  type TriggerDecision,
  type TriggerDispatch,
  type TriggerEvent,
  type TriggerGate,
  type TriggerGates,
  type TriggerRouterDeps,
  type TriggerRule,
  type TriggerRuleMap,
} from './triggers.js';

export {
  definePersistentAgent,
  dynamoAgentStore,
  memoryAgentStore,
  AGENT_CHECK_IN_DETAIL_TYPE,
  CHECK_IN_KIND,
  FOLLOW_UP_DETAIL_TYPE,
  type PersistentAgent,
  type PersistentAgentCheckIn,
  type PersistentAgentDefinition,
  type PersistentAgentObservation,
  type PersistentAgentProfile,
  type PersistentAgentStore,
  type PersistentFollowUp,
  type PersistentPromise,
  type PersistentStateKey,
  type PersistentTaskContext,
  type PersistentTaskHandler,
} from './persistent.js';

export type { TaskTrigger } from '../memory/task-events.js';
