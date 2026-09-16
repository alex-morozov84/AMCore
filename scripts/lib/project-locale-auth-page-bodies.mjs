export const AUTH_PAGE_BODIES = Object.freeze({
  ForgotPassword: `export default async function ForgotPassword() {
  return <ForgotPasswordPage />
}`,
  ResendVerification: `export default async function ResendVerification() {
  return <ResendVerificationPage />
}`,
  ResetPassword: `export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <ResetPasswordPage token={token} />
}`,
  VerifyEmail: `export default async function VerifyEmail({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token: rawToken } = await searchParams
  const token = typeof rawToken === 'string' ? rawToken : undefined

  return <VerifyEmailPage token={token} />
}`,
  Login: `export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string | string[] }>
}) {
  await redirectIfAuthenticated()

  const [oauthProviders, { oauthError }] = await Promise.all([getOAuthProviders(), searchParams])

  return <LoginPage oauthProviders={oauthProviders} oauthError={oauthError} />
}`,
  Register: `export default async function Register() {
  await redirectIfAuthenticated()

  const oauthProviders = await getOAuthProviders()

  return <RegisterPage oauthProviders={oauthProviders} />
}`,
})
