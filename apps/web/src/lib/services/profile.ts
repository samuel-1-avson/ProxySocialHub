/**
 * @deprecated Import profile reads/writes from `@/lib/api/profile`.
 * This file re-exports so older call sites keep working.
 */
export {
    getProfile,
    getMyProfile,
    getPublicProfile,
    updateProfile,
    followUser,
    unfollowUser,
    blockUser,
    unblockUser,
    getUserActivity,
    getUserReviews,
    deleteAccount,
    exportAccountData,
    type UserPublicProfile,
    type Review,
    type ActivityEvent,
} from '../api/profile';
