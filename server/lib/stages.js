import { conflict } from './http.js';

export const STAGES = {
  applied:        { label: 'Applied',         tone: 'neutral', blurb: 'Sitting with the panel for a first read.' },
  screening:      { label: 'Screening',       tone: 'info',    blurb: 'Someone at DAC is reading your application now.' },
  interview:      { label: 'Interview open',  tone: 'action',  blurb: 'Your audio interview is unlocked. Record your answers.' },
  evaluation:     { label: 'Under review',    tone: 'info',    blurb: 'Your answers are in. The panel is listening.' },
  approved:       { label: 'Approved',        tone: 'good',    blurb: 'Approved by the panel. Your offer letter is on the way.' },
  offer_sent:     { label: 'Offer sent',      tone: 'good',    blurb: 'Your offer letter is ready to read and respond to.' },
  offer_accepted: { label: 'Offer accepted',  tone: 'good',    blurb: 'Welcome to the DGU AI Cell.' },
  offer_declined: { label: 'Offer declined',  tone: 'muted',   blurb: 'You turned this one down. No hard feelings.' },
  rejected:       { label: 'Not selected',    tone: 'bad',     blurb: 'Not this time. The door stays open for future roles.' },
  withdrawn:      { label: 'Withdrawn',       tone: 'muted',   blurb: 'You withdrew this application.' },
};

/** Stages an admin may move an application to by hand, keyed by current stage. */
const ADMIN_MOVES = {
  applied:        ['screening', 'interview', 'rejected'],
  screening:      ['interview', 'rejected', 'applied'],
  interview:      ['evaluation', 'screening', 'rejected'],
  evaluation:     ['approved', 'rejected', 'interview'],
  approved:       ['evaluation', 'rejected'],
  offer_sent:     ['approved'],
  offer_accepted: [],
  offer_declined: ['approved'],
  rejected:       ['screening', 'evaluation'],
  withdrawn:      [],
};

export const adminMovesFrom = (stage) => ADMIN_MOVES[stage] ?? [];

export function assertAdminMove(from, to) {
  if (from === to) throw conflict(`This application is already at "${STAGES[to]?.label ?? to}".`);
  if (!adminMovesFrom(from).includes(to)) {
    throw conflict(`You cannot move an application from "${STAGES[from]?.label ?? from}" to "${STAGES[to]?.label ?? to}".`);
  }
}

/** Stages where the candidate can still see and use the interview screen. */
export const INTERVIEW_OPEN = new Set(['interview']);

/** Stages that count as finished — no further candidate action. */
export const TERMINAL = new Set(['rejected', 'withdrawn', 'offer_accepted', 'offer_declined']);
