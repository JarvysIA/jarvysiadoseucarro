export const PROFILE_STATUS_VALUES = ["trial", "ativo", "vip", "enterprise", "desativado"] as const;

export type ProfileStatus = (typeof PROFILE_STATUS_VALUES)[number];
