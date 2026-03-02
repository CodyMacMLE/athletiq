"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { cognitoResetPassword, cognitoConfirmResetPassword } from "@/lib/cognito";
import { Loader2, Eye, EyeOff } from "lucide-react";

const inputClass =
  "w-full px-4 py-3 bg-white/8 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#6c5ce7] focus:border-transparent";
const labelClass = "block text-xs font-medium text-white/55 mb-1.5";

const gradientStyle = {
  background: "linear-gradient(160deg, #302b6f 10%, #4d2a69 60%, #302b6f 100%)",
};

export default function SignInPage() {
  const router = useRouter();
  const { login, confirmNewPassword } = useAuth();

  const [view, setView] = useState<"login" | "forgot" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [requiresNewPassword, setRequiresNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  const doLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresNewPassword) {
        setRequiresNewPassword(true);
      } else if (!result.success) {
        setError(result.error || "Login failed");
      } else {
        router.replace("/dashboard");
        return;
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    }
    setLoading(false);
  };

  const doSetNewPassword = async () => {
    setError("");
    if (newPassword !== confirmPw) { setError("Passwords do not match"); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const result = await confirmNewPassword(newPassword);
      if (!result.success) {
        setError(result.error || "Failed to set new password");
      } else {
        router.replace("/dashboard");
        return;
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    }
    setLoading(false);
  };

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); doLogin(); };
  const handleNewPasswordSubmit = (e: FormEvent) => { e.preventDefault(); doSetNewPassword(); };

  const handleSendResetCode = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await cognitoResetPassword(email);
    if (result.success) { setView("reset"); } else { setError(result.error || "Failed to send reset code"); }
    setLoading(false);
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPw) { setError("Passwords do not match."); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    const result = await cognitoConfirmResetPassword(email, resetCode, newPassword);
    if (result.success) {
      setSuccessMessage("Password reset successfully. You can now sign in.");
      setResetCode(""); setNewPassword(""); setConfirmPw("");
      setView("login");
    } else {
      setError(result.error || "Failed to reset password");
    }
    setLoading(false);
  };

  const backToLogin = () => {
    setView("login"); setError(""); setResetCode("");
    setNewPassword(""); setConfirmPw(""); setSuccessMessage("");
  };

  if (requiresNewPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={gradientStyle}>
        <div className="w-full max-w-md">
          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8">
            <h1 className="text-2xl font-bold text-white mb-1">Set New Password</h1>
            <p className="text-white/50 text-sm mb-6">Please create a new password for your account.</p>

            {error && <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm">{error}</div>}

            <form onSubmit={handleNewPasswordSubmit} className="space-y-4">
              <div>
                <label className={labelClass}>New Password</label>
                <div className="relative">
                  <input type={showNewPassword ? "text" : "password"} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={`${inputClass} pr-11`} placeholder="Min. 8 characters" minLength={8} />
                  <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors">
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>Confirm Password</label>
                <div className="relative">
                  <input type={showConfirmPw ? "text" : "password"} required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className={`${inputClass} pr-11`} placeholder="Re-enter password" minLength={8} />
                  <button type="button" onClick={() => setShowConfirmPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors">
                    {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting password…</> : "Set Password"}
              </button>
              <button type="button" onClick={() => { setRequiresNewPassword(false); setNewPassword(""); setConfirmPw(""); setError(""); }} className="w-full text-center text-white/45 hover:text-white text-sm transition-colors">
                Back to sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={gradientStyle}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <Image src="/logo/white_icon_transparent_background.png" alt="Athletiq" width={72} height={72} className="mx-auto mb-4" />
          </Link>
          <h1 className="text-2xl font-bold text-white">
            {view === "login" && "Welcome back"}
            {view === "forgot" && "Reset your password"}
            {view === "reset" && "Enter reset code"}
          </h1>
          <p className="text-white/45 text-sm mt-1">
            {view === "login" && "Sign in to your Athletiq account"}
            {view === "forgot" && "We'll send a code to your email"}
            {view === "reset" && `Code sent to ${email}`}
          </p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8">
          {successMessage && (
            <div className="mb-4 px-4 py-3 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm">{successMessage}</div>
          )}
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm">{error}</div>
          )}

          {view === "login" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setSuccessMessage(""); }} className={inputClass} placeholder="you@example.com" autoFocus />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-11`} placeholder="Enter your password" />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="text-right">
                <button type="button" onClick={() => { setView("forgot"); setError(""); setSuccessMessage(""); }} className="text-xs text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">
                  Forgot password?
                </button>
              </div>
              <button type="submit" disabled={loading} className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : "Sign In"}
              </button>
              <p className="text-center text-sm text-white/40 pt-1">
                Don&apos;t have an account?{" "}
                <Link href="/register" className="text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">Register</Link>
                {" · "}
                <Link href="/" className="text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">Home</Link>
              </p>
            </form>
          )}

          {view === "forgot" && (
            <form onSubmit={handleSendResetCode} className="space-y-4">
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@example.com" autoFocus />
              </div>
              <button type="submit" disabled={loading} className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : "Send Reset Code"}
              </button>
              <div className="text-center">
                <button type="button" onClick={backToLogin} className="text-sm text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">Back to sign in</button>
              </div>
            </form>
          )}

          {view === "reset" && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className={labelClass}>Reset Code</label>
                <input type="text" required value={resetCode} onChange={(e) => setResetCode(e.target.value)} className={`${inputClass} tracking-widest text-center text-lg`} placeholder="123456" autoFocus />
              </div>
              <div>
                <label className={labelClass}>New Password</label>
                <div className="relative">
                  <input type={showNewPassword ? "text" : "password"} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={`${inputClass} pr-11`} placeholder="Min. 8 characters" minLength={8} />
                  <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors">
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className={labelClass}>Confirm Password</label>
                <div className="relative">
                  <input type={showConfirmPw ? "text" : "password"} required value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className={`${inputClass} pr-11`} placeholder="Re-enter password" minLength={8} />
                  <button type="button" onClick={() => setShowConfirmPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors">
                    {showConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Resetting…</> : "Reset Password"}
              </button>
              <div className="text-center">
                <button type="button" onClick={backToLogin} className="text-sm text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">Back to sign in</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
