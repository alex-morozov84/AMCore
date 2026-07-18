// Re-export from auth for backwards compatibility
// Main auth schemas are in auth.ts
export {
  type LoginInput,
  loginSchema,
  type RegisterInput,
  registerSchema,
  type UserResponse as User,
  userResponseSchema as userSchema,
} from './auth'
