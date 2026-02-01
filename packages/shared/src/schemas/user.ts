// Re-export from auth for backwards compatibility
// Main auth schemas are in auth.ts
export {
  registerSchema,
  loginSchema,
  userResponseSchema as userSchema,
  type RegisterInput,
  type LoginInput,
  type UserResponse as User,
} from './auth'
