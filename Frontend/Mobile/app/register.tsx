import { useAuth } from "@/contexts/AuthContext";
import { cognitoSignUp, cognitoConfirmSignUp, cognitoResendSignUpCode, cognitoSignIn } from "@/lib/cognito";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useLazyQuery } from "@apollo/client";
import { CREATE_USER, ACCEPT_INVITE } from "@/lib/graphql/mutations";
import { MY_PENDING_INVITES } from "@/lib/graphql/queries";

export default function Register() {
  const { refetchUser } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("");

  // Confirmation flow
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [resending, setResending] = useState(false);
  const [codeResentNotice, setCodeResentNotice] = useState(false);

  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const [createUser] = useMutation(CREATE_USER);
  const [acceptInvite] = useMutation(ACCEPT_INVITE);
  const [fetchPendingInvites] = useLazyQuery(MY_PENDING_INVITES, { fetchPolicy: "network-only" });

  const handleRegister = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) {
      setError("Please fill in all fields.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setError("");
    setLoading(true);
    setStep("Creating account...");

    try {
      const signUpResult = await cognitoSignUp(email.trim(), password);
      if (!signUpResult.success) {
        const err = signUpResult.error || "";
        if (err.includes("already exists") || err.includes("UsernameExistsException")) {
          // Try resending — if it succeeds the account is unconfirmed and we can resume.
          setStep("Checking account status...");
          const resendResult = await cognitoResendSignUpCode(email.trim());
          if (resendResult.success) {
            setCodeResentNotice(true);
            setConfirmationCode("");
            setNeedsConfirmation(true);
          } else {
            setError("An account with this email already exists. Please sign in instead.");
          }
          setLoading(false);
          return;
        }
        setError(err || "Failed to create account.");
        setLoading(false);
        return;
      }

      setNeedsConfirmation(true);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirmationCode.trim()) {
      setError("Please enter the confirmation code.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      setStep("Verifying email...");
      const confirmResult = await cognitoConfirmSignUp(email.trim(), confirmationCode.trim());
      if (!confirmResult.success) {
        const alreadyConfirmed = confirmResult.error?.includes("Current status is CONFIRMED");
        if (!alreadyConfirmed) {
          setError(confirmResult.error || "Invalid confirmation code.");
          setLoading(false);
          return;
        }
      }

      setStep("Signing in...");
      const signInResult = await cognitoSignIn(email.trim(), password);
      if (!signInResult.success) {
        setError(signInResult.error || "Failed to sign in.");
        setLoading(false);
        return;
      }

      setStep("Setting up your profile...");
      try {
        await createUser({
          variables: {
            input: {
              email: email.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
            },
          },
        });
      } catch {
        // User may already exist
      }

      // Check for pending invites and auto-accept
      setStep("Checking for invitations...");
      try {
        const { data } = await fetchPendingInvites();
        const invites = data?.myPendingInvites || [];
        for (const invite of invites) {
          try {
            await acceptInvite({ variables: { token: invite.token } });
          } catch {
            // Skip failed invites
          }
        }
      } catch {
        // No invites or query failed — continue
      }

      refetchUser();
      router.replace("/(tabs)");
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError("");
    setResending(true);
    const result = await cognitoResendSignUpCode(email.trim());
    if (!result.success) {
      setError(result.error || "Failed to resend code.");
    }
    setResending(false);
  };

  if (needsConfirmation) {
    return (
      <LinearGradient
        colors={["#302b6f", "#4d2a69", "#302b6f"]}
        style={styles.gradient}
        locations={[0.1, 0.6, 1]}
      >
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.container}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Branding */}
            <View style={styles.branding}>
              <Image source={require("@/assets/logo/white_icon_transparent_background.png")} style={styles.logoImage} resizeMode="contain" />
            </View>

            <Text style={styles.heading}>Verify Your Email</Text>
            <Text style={styles.subheading}>
              We sent a confirmation code to {email}
            </Text>

            {/* Resent notice */}
            {codeResentNotice ? (
              <View style={styles.noticeBox}>
                <Feather name="info" size={16} color="#818cf8" />
                <Text style={styles.noticeText}>
                  A new verification code has been sent to your email.
                </Text>
              </View>
            ) : null}

            {/* Error */}
            {error ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={16} color="#e74c3c" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Confirmation Code */}
            <View style={styles.inputContainer}>
              <Feather name="hash" size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { textAlign: "center", letterSpacing: 8, fontSize: 20 }]}
                placeholder="123456"
                placeholderTextColor="rgba(255,255,255,0.3)"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                value={confirmationCode}
                onChangeText={(text) => {
                  setConfirmationCode(text);
                  setError("");
                }}
                maxLength={6}
                autoFocus
                returnKeyType="go"
                onSubmitEditing={handleConfirm}
              />
            </View>

            {/* Verify Button */}
            <Pressable
              style={({ pressed }) => [
                styles.signInButton,
                pressed && styles.signInButtonPressed,
                loading && styles.signInButtonDisabled,
              ]}
              onPress={handleConfirm}
              disabled={loading}
            >
              <LinearGradient
                colors={["#6c5ce7", "#a855f7"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.signInGradient}
              >
                {loading ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="white" />
                    <Text style={styles.signInText}>{step}</Text>
                  </View>
                ) : (
                  <Text style={styles.signInText}>Verify & Continue</Text>
                )}
              </LinearGradient>
            </Pressable>

            {/* Resend code */}
            <Pressable
              style={styles.registerRow}
              onPress={handleResendCode}
              disabled={resending}
            >
              <Text style={styles.registerText}>
                Didn't receive the code?{" "}
                <Text style={styles.registerLink}>
                  {resending ? "Sending..." : "Resend code"}
                </Text>
              </Text>
            </Pressable>

            {/* Back / use different email */}
            <Pressable
              style={[styles.registerRow, { marginTop: 8 }]}
              onPress={() => {
                setNeedsConfirmation(false);
                setConfirmationCode("");
                setError("");
              }}
            >
              <Text style={styles.registerText}>
                Wrong email?{" "}
                <Text style={styles.registerLink}>Use a different email</Text>
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient
      colors={["#302b6f", "#4d2a69", "#302b6f"]}
      style={styles.gradient}
      locations={[0.1, 0.6, 1]}
    >
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Branding */}
          <View style={styles.branding}>
            <Image source={require("@/assets/logo/white_icon_transparent_background.png")} style={styles.logoImage} resizeMode="contain" />
          </View>

          <Text style={styles.heading}>Create Account</Text>
          <Text style={styles.subheading}>Sign up for Athletiq</Text>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Feather name="alert-circle" size={16} color="#e74c3c" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Name Row */}
          <View style={styles.nameRow}>
            <View style={[styles.inputContainer, { flex: 1, marginRight: 8 }]}>
              <Feather name="user" size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="First Name"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
                value={firstName}
                onChangeText={setFirstName}
                returnKeyType="next"
                onSubmitEditing={() => lastNameRef.current?.focus()}
              />
            </View>
            <View style={[styles.inputContainer, { flex: 1 }]}>
              <TextInput
                ref={lastNameRef}
                style={styles.input}
                placeholder="Last Name"
                placeholderTextColor="rgba(255,255,255,0.3)"
                autoCapitalize="words"
                value={lastName}
                onChangeText={setLastName}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </View>
          </View>

          {/* Email */}
          <View style={styles.inputContainer}>
            <Feather name="mail" size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
            <TextInput
              ref={emailRef}
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="rgba(255,255,255,0.3)"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>

          {/* Password */}
          <View style={styles.inputContainer}>
            <Feather name="lock" size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
            <TextInput
              ref={passwordRef}
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              returnKeyType="next"
              onSubmitEditing={() => confirmPasswordRef.current?.focus()}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
              <Feather
                name={showPassword ? "eye-off" : "eye"}
                size={18}
                color="rgba(255,255,255,0.4)"
              />
            </Pressable>
          </View>

          {/* Confirm Password */}
          <View style={styles.inputContainer}>
            <Feather name="lock" size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
            <TextInput
              ref={confirmPasswordRef}
              style={styles.input}
              placeholder="Confirm Password"
              placeholderTextColor="rgba(255,255,255,0.3)"
              secureTextEntry={!showPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              autoCapitalize="none"
              returnKeyType="go"
              onSubmitEditing={handleRegister}
            />
          </View>

          {/* Register Button */}
          <Pressable
            style={({ pressed }) => [
              styles.signInButton,
              pressed && styles.signInButtonPressed,
              loading && styles.signInButtonDisabled,
            ]}
            onPress={handleRegister}
            disabled={loading}
          >
            <LinearGradient
              colors={["#6c5ce7", "#a855f7"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.signInGradient}
            >
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color="white" />
                  <Text style={styles.signInText}>{step}</Text>
                </View>
              ) : (
                <Text style={styles.signInText}>Create Account</Text>
              )}
            </LinearGradient>
          </Pressable>

          {/* Sign In link */}
          <Pressable
            style={styles.registerRow}
            onPress={() => router.back()}
          >
            <Text style={styles.registerText}>
              Already have an account?{" "}
              <Text style={styles.registerLink}>Sign In</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  branding: {
    alignItems: "center",
    marginBottom: 40,
  },
  logoImage: {
    width: 120,
    height: 120,
  },
  heading: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 8,
  },
  subheading: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 32,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(231,76,60,0.15)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(231,76,60,0.3)",
  },
  errorText: {
    color: "#e74c3c",
    fontSize: 14,
    flex: 1,
  },
  noticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(99,102,241,0.15)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.3)",
  },
  noticeText: {
    color: "#818cf8",
    fontSize: 14,
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    marginBottom: 0,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: "white",
    fontSize: 16,
    paddingVertical: 16,
  },
  signInButton: {
    marginTop: 8,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#a855f7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  signInButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  signInButtonDisabled: {
    opacity: 0.7,
  },
  signInGradient: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  signInText: {
    color: "white",
    fontSize: 17,
    fontWeight: "bold",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  registerRow: {
    marginTop: 20,
    alignItems: "center",
  },
  registerText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
  },
  registerLink: {
    color: "#a855f7",
    fontWeight: "600",
  },
});
