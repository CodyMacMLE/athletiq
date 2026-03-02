"use client";

import { Amplify } from "aws-amplify";
import {
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  confirmSignIn,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
  type SignInInput,
} from "aws-amplify/auth";

// Configure Amplify with Cognito
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: "us-east-2_jHLnfwOqy",
      userPoolClientId: "3e0jmpi1vpsbkntof8h6u7eov0",
    },
  },
});

export type CognitoUser = {
  userId: string;
  username: string;
  email?: string;
};

export type SignInResult = {
  success: boolean;
  error?: string;
  requiresNewPassword?: boolean;
  requiresConfirmation?: boolean;
};

export async function cognitoSignUp(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await signUp({
      username: email,
      password,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign up failed";
    return { success: false, error: message };
  }
}

export async function cognitoConfirmSignUp(
  email: string,
  confirmationCode: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await confirmSignUp({ username: email, confirmationCode });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Confirmation failed";
    return { success: false, error: message };
  }
}

export async function cognitoResendSignUpCode(
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await resendSignUpCode({ username: email });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resend code";
    return { success: false, error: message };
  }
}

export async function cognitoSignIn(
  username: string,
  password: string
): Promise<SignInResult> {
  try {
    const input: SignInInput = { username, password };
    const result = await signIn(input);

    if (result.isSignedIn) {
      return { success: true };
    }

    // Handle new password required challenge
    if (result.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      return { success: false, requiresNewPassword: true };
    }

    // Account exists but email not yet confirmed
    if (result.nextStep?.signInStep === "CONFIRM_SIGN_UP") {
      return { success: false, requiresConfirmation: true };
    }

    // Handle other challenges
    if (result.nextStep) {
      return {
        success: false,
        error: `Additional step required: ${result.nextStep.signInStep}`,
      };
    }

    return { success: false, error: "Sign in failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign in failed";
    return { success: false, error: message };
  }
}

export async function cognitoConfirmNewPassword(
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await confirmSignIn({
      challengeResponse: newPassword,
    });

    if (result.isSignedIn) {
      return { success: true };
    }

    if (result.nextStep) {
      return {
        success: false,
        error: `Additional step required: ${result.nextStep.signInStep}`,
      };
    }

    return { success: false, error: "Password change failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password change failed";
    return { success: false, error: message };
  }
}

export async function cognitoResetPassword(
  email: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await resetPassword({ username: email });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reset code";
    return { success: false, error: message };
  }
}

export async function cognitoConfirmResetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset password";
    return { success: false, error: message };
  }
}

export async function cognitoSignOut(): Promise<void> {
  try {
    await signOut();
  } catch (error) {
    console.error("Sign out error:", error);
  }
}

export async function getCognitoUser(): Promise<CognitoUser | null> {
  try {
    const user = await getCurrentUser();
    return {
      userId: user.userId,
      username: user.username,
    };
  } catch {
    return null;
  }
}

export async function getAuthToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() || null;
  } catch {
    return null;
  }
}
