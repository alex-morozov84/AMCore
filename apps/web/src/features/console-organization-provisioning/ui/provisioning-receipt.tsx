import { useTranslations } from 'next-intl'

import { getConsoleOrganizationDetailHref } from '@/shared/lib/console-public-href'
import { Button, buttonVariants } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

/** Acknowledgment belongs to this action only; unfinished work lives on the server. */
export function ProvisioningReceipt({
  organizationId,
  onClose,
}: {
  organizationId: string
  onClose: () => void
}) {
  const t = useTranslations('console.organizationProvisioning')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent closeLabel={t('closeResult')}>
        <DialogHeader>
          <DialogTitle>{t('created')}</DialogTitle>
          <DialogDescription>{t('receiptHelp')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('dismissReceipt')}
          </Button>
          <RouteProgressLink
            href={getConsoleOrganizationDetailHref(organizationId)}
            className={buttonVariants()}
          >
            {t('openOrganization')}
          </RouteProgressLink>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
