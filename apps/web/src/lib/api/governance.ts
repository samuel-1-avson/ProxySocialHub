/**
 * Governance API — re-exported from the canonical service module.
 */
export {
    castGovernanceVote,
    castVote,
    createProposal,
    getGovernanceExecutionReadiness,
    getProposal,
    getProposals,
    type CreateProposalInput,
    type GovernanceExecutionReport,
    type Proposal,
    type Vote,
} from '../services/governance';
