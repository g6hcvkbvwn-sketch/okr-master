import { useUserColor } from "./user-colors";

export function OwnerBadge({
  user,
}: {
  user: { id: string; name: string };
}) {
  const color = useUserColor(user.id);
  return (
    <span
      className="owner-tag"
      style={{ color: color.text, background: color.background }}
    >
      {user.name}
    </span>
  );
}

export function UserAvatar({ user }: { user: { id: string; name: string } }) {
  const color = useUserColor(user.id);
  return (
    <div
      aria-hidden="true"
      className="avatar"
      style={{ color: color.text, background: color.background }}
    >
      {user.name.slice(0, 1).toUpperCase()}
    </div>
  );
}
