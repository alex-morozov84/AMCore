import { ProductAdminLoginPage } from '@/_app/product-admin'

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; oauthError?: string | string[] }>
}) {
  return <ProductAdminLoginPage query={await searchParams} />
}
