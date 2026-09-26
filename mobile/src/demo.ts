/** Simulation only: these actions are NOT a transport authentication boundary. */
export type Stage = 'unpaired' | 'pairing' | 'ready' | 'pin' | 'review'
  | 'signing' | 'complete' | 'rejected' | 'expired' | 'locked';
export type DemoState = {
  stage: Stage; paired: boolean; requestId: string | null; deadline: number;
};
export const initialState: DemoState = {
  stage: 'unpaired', paired: false, requestId: null, deadline: 0,
};
export const DEMO_PEER = 'a'.repeat(64);
export const demoTransaction = {
  client: 'LNbits demo browser',
  recipient: 'tb1qexample-recipient-simulation-only',
  change: 'tb1qexample-change-simulation-only',
  amount: 25_000, changeAmount: 74_500, fee: 500, inputAmount: 100_000,
};
export type Action =
  | { type: 'pair'; now: number }
  | { type: 'confirmPair'; now: number }
  | { type: 'cancelPair' | 'lock' | 'revoke' }
  | { type: 'request'; id: string; now: number }
  | { type: 'unlock' | 'approve' | 'reject' | 'finish'; id: string; now: number }
  | { type: 'tick'; now: number };
export const isActive = (state: DemoState) =>
  ['pairing', 'pin', 'review', 'signing'].includes(state.stage);

export function reducer(state: DemoState, action: Action): DemoState {
  if (action.type === 'revoke') return { ...initialState };
  if (action.type === 'lock') {
    return { ...state, stage: state.paired ? 'locked' : 'unpaired', requestId: null, deadline: 0 };
  }
  // Check time on every approval-related action, not only the display timer.
  if ('now' in action && isActive(state) && action.now >= state.deadline) {
    return { ...state, stage: 'expired', requestId: null, deadline: 0 };
  }
  switch (action.type) {
    case 'pair':
      return !state.paired && !isActive(state)
        ? { ...state, stage: 'pairing', deadline: action.now + 180_000 } : state;
    case 'confirmPair':
      return state.stage === 'pairing'
        ? { ...state, stage: 'ready', paired: true, deadline: 0 } : state;
    case 'cancelPair':
      return state.stage === 'pairing' ? { ...initialState } : state;
    case 'request':
      return state.paired && !isActive(state) && /^[0-9a-f]{32}$/.test(action.id)
        ? { ...state, stage: 'pin', requestId: action.id, deadline: action.now + 150_000 } : state;
    case 'unlock':
    case 'approve':
    case 'reject':
    case 'finish': {
      if (action.id !== state.requestId) return state;
      if (action.type === 'unlock' && state.stage === 'pin') return { ...state, stage: 'review' };
      if (action.type === 'approve' && state.stage === 'review') return { ...state, stage: 'signing' };
      if (action.type === 'finish' && state.stage === 'signing') {
        return { ...state, stage: 'complete', requestId: null, deadline: 0 };
      }
      if (action.type === 'reject' && ['pin', 'review'].includes(state.stage)) {
        return { ...state, stage: 'rejected', requestId: null, deadline: 0 };
      }
      return state;
    }
    default: return state;
  }
}
