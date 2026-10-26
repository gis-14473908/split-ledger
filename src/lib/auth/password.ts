/** Error message for a new password, or null when it is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < 6) return "密码至少 6 位";
  if (password !== confirm) return "两次输入的密码不一样";
  return null;
}
