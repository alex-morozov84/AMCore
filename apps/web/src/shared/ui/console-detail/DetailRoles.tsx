export function DetailRoles({
  roles,
  empty,
}: {
  roles: { id: string; name: string }[]
  empty: string
}) {
  if (roles.length === 0) return <span className="text-muted-foreground">{empty}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <span key={role.id} className="rounded border border-border px-2 py-0.5 text-xs">
          {role.name}
        </span>
      ))}
    </span>
  )
}
