import { apiPost } from './client';

export type ExtensionPairStartResponse = {
    code: string;
    expires_in: number;
};

export function startExtensionPair() {
    return apiPost<ExtensionPairStartResponse>('/v1/extension/pair/start', {});
}
