import { Alert } from 'react-native';

export interface AppError {
    code: string;
    message: string;
    details?: any;
    timestamp: number;
    context: {
        component: string;
        action: string;
        userId?: string;
    };
}

export interface NetworkError extends AppError {
    statusCode?: number;
    retryable: boolean;
    retryAfter?: number;
}

export class ErrorHandler {
    static createError(
        code: string,
        message: string,
        component: string,
        action: string,
        details?: any,
        userId?: string
    ): AppError {
        return {
            code,
            message,
            details,
            timestamp: Date.now(),
            context: {
                component,
                action,
                userId,
            },
        };
    }

    static handleAuthError(error: any, component: string, action: string): void {
        console.error(`Auth error in ${component}.${action}:`, error);

        let userMessage = 'Authentication failed. Please try again.';
        let title = 'Authentication Error';

        // Handle specific error types
        if (error?.message) {
            const message = error.message.toLowerCase();
            
            if (message.includes('invalid_credentials') || message.includes('invalid login')) {
                userMessage = 'Invalid email or password. Please check your credentials and try again.';
            } else if (message.includes('email_not_confirmed')) {
                userMessage = 'Please check your email and click the confirmation link before signing in.';
            } else if (message.includes('too_many_requests')) {
                userMessage = 'Too many login attempts. Please wait a few minutes before trying again.';
            } else if (message.includes('network') || message.includes('connection')) {
                userMessage = 'Network connection error. Please check your internet connection and try again.';
                title = 'Connection Error';
            } else if (message.includes('wallet')) {
                userMessage = 'Wallet connection failed. Please make sure Phantom wallet is installed and try again.';
                title = 'Wallet Error';
            } else if (message.includes('timeout')) {
                userMessage = 'Request timed out. Please try again.';
                title = 'Timeout Error';
            }
        }

        Alert.alert(title, userMessage, [
            { text: 'OK', style: 'default' }
        ]);

        // Log structured error
        const structuredError = this.createError(
            error?.code || 'AUTH_ERROR',
            error?.message || 'Unknown authentication error',
            component,
            action,
            error
        );
        
        this.logError(structuredError);
    }

    static handleNetworkError(error: any, component: string, action: string): void {
        console.error(`Network error in ${component}.${action}:`, error);

        let userMessage = 'Network error occurred. Please try again.';
        let title = 'Connection Error';
        let retryable = true;

        if (error?.status) {
            const status = error.status;
            
            if (status >= 400 && status < 500) {
                // Client errors
                if (status === 401) {
                    userMessage = 'Your session has expired. Please sign in again.';
                    title = 'Session Expired';
                    retryable = false;
                } else if (status === 403) {
                    userMessage = 'You don\'t have permission to perform this action.';
                    title = 'Access Denied';
                    retryable = false;
                } else if (status === 404) {
                    userMessage = 'The requested resource was not found.';
                    title = 'Not Found';
                    retryable = false;
                } else {
                    userMessage = 'Invalid request. Please check your input and try again.';
                    title = 'Request Error';
                    retryable = false;
                }
            } else if (status >= 500) {
                // Server errors
                userMessage = 'Server error occurred. Please try again in a few moments.';
                title = 'Server Error';
                retryable = true;
            }
        } else if (error?.isNetworkError) {
            userMessage = 'No internet connection. Please check your network and try again.';
            title = 'No Internet';
            retryable = true;
        }

        const buttons = retryable 
            ? [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Retry', style: 'default', onPress: () => {
                    // Emit retry event or callback if provided
                    if (error?.retry) {
                        error.retry();
                    }
                }}
            ]
            : [{ text: 'OK', style: 'default' }];

        Alert.alert(title, userMessage, buttons);

        // Log structured error
        const networkError: NetworkError = {
            ...this.createError(
                error?.code || 'NETWORK_ERROR',
                error?.message || 'Network request failed',
                component,
                action,
                error
            ),
            statusCode: error?.status,
            retryable,
            retryAfter: error?.retryAfter,
        };
        
        this.logError(networkError);
    }

    static handleWalletError(error: any, component: string, action: string): void {
        console.error(`Wallet error in ${component}.${action}:`, error);

        let userMessage = 'Wallet operation failed. Please try again.';
        let title = 'Wallet Error';

        if (error?.message) {
            const message = error.message.toLowerCase();
            
            if (message.includes('not installed') || message.includes('not found')) {
                userMessage = 'Phantom wallet is not installed. Please install it from the app store and try again.';
                title = 'Wallet Not Found';
            } else if (message.includes('rejected') || message.includes('cancelled')) {
                userMessage = 'Transaction was cancelled. Please try again if you want to continue.';
                title = 'Transaction Cancelled';
            } else if (message.includes('insufficient')) {
                userMessage = 'Insufficient funds to complete the transaction.';
                title = 'Insufficient Funds';
            } else if (message.includes('timeout')) {
                userMessage = 'Wallet connection timed out. Please try again.';
                title = 'Connection Timeout';
            } else if (message.includes('signature')) {
                userMessage = 'Message signing failed. Please try again.';
                title = 'Signing Failed';
            }
        }

        Alert.alert(title, userMessage, [
            { text: 'OK', style: 'default' }
        ]);

        // Log structured error
        const structuredError = this.createError(
            error?.code || 'WALLET_ERROR',
            error?.message || 'Wallet operation failed',
            component,
            action,
            error
        );
        
        this.logError(structuredError);
    }

    static handleGenericError(error: any, component: string, action: string, customMessage?: string): void {
        console.error(`Generic error in ${component}.${action}:`, error);

        const userMessage = customMessage || 'An unexpected error occurred. Please try again.';
        const title = 'Error';

        Alert.alert(title, userMessage, [
            { text: 'OK', style: 'default' }
        ]);

        // Log structured error
        const structuredError = this.createError(
            error?.code || 'GENERIC_ERROR',
            error?.message || 'Unexpected error occurred',
            component,
            action,
            error
        );
        
        this.logError(structuredError);
    }

    private static logError(error: AppError | NetworkError): void {
        // In a production app, you would send this to a logging service
        // For now, just log to console with structured format
        console.log('Structured Error Log:', JSON.stringify(error, null, 2));
        
        // TODO: Send to analytics/logging service
        // Analytics.logError(error);
    }

    static getErrorRecoveryActions(error: AppError): string[] {
        const actions: string[] = [];

        if (error.code.includes('NETWORK') || error.code.includes('CONNECTION')) {
            actions.push('Check your internet connection');
            actions.push('Try again in a few moments');
        }

        if (error.code.includes('AUTH')) {
            actions.push('Sign out and sign back in');
            actions.push('Clear app data and restart');
        }

        if (error.code.includes('WALLET')) {
            actions.push('Make sure Phantom wallet is installed');
            actions.push('Check wallet connection');
            actions.push('Try connecting wallet again');
        }

        if (actions.length === 0) {
            actions.push('Restart the app');
            actions.push('Contact support if the problem persists');
        }

        return actions;
    }
}