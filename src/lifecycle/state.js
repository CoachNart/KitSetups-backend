'use strict';
const STATES=Object.freeze({READY:'READY',ENTRY_HIT:'ENTRY_HIT',ACTIVE:'ACTIVE',TP1_HIT:'TP1_HIT',TP2_HIT:'TP2_HIT',TP3_HIT:'TP3_HIT',STOP_LOSS:'STOP_LOSS',MISSED:'MISSED',CLOSED:'CLOSED'});
const TRANSITIONS=Object.freeze({READY:new Set(['ENTRY_HIT','MISSED']),ENTRY_HIT:new Set(['ACTIVE']),ACTIVE:new Set(['TP1_HIT','STOP_LOSS','CLOSED']),TP1_HIT:new Set(['TP2_HIT','STOP_LOSS','CLOSED']),TP2_HIT:new Set(['TP3_HIT','STOP_LOSS','CLOSED']),TP3_HIT:new Set(['CLOSED']),STOP_LOSS:new Set(['CLOSED']),MISSED:new Set(),CLOSED:new Set()});
const TERMINAL_STATES=new Set(['MISSED','CLOSED']);
const canTransition=(from,to)=>Boolean(TRANSITIONS[from]?.has(to));
const isTerminal=state=>TERMINAL_STATES.has(state);
function assertTransition(from,to){if(!canTransition(from,to))throw new Error(`Invalid lifecycle transition: ${from} -> ${to}`);return true;}
module.exports={STATES,TERMINAL_STATES,TRANSITIONS,canTransition,isTerminal,assertTransition};
