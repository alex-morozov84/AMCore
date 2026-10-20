import { ProductAdminLinkedPage } from '@/_app/product-admin'

export default async function Linked({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string | string[] }>
}) {
  return <ProductAdminLinkedPage linked={(await searchParams).linked} />
}
