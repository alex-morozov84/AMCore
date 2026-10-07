import { getTranslations } from 'next-intl/server'

import { RecipientFrame, RecipientSkeleton } from '@/_pages/invitation-recipient'

export default async function Loading() {
  const t = await getTranslations('invitationRecipient')
  return (
    <RecipientFrame>
      <RecipientSkeleton kind="auth" label={t('loading')} />
    </RecipientFrame>
  )
}
