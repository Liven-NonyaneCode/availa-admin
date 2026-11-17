import { Link } from "react-router-dom";

export default function BrandMark({ to = "/", tag = true }: { to?: string; tag?: boolean }) {
  return (
    <Link to={to} className="brandLockup" aria-label="Availa Admin home">
      <img src="/availa-mark.png" alt="" className="brandMarkImg" width={32} height={32} decoding="async" />
      <span className="brandWordmark">Availa</span>
      {tag && <span className="brandTag">Admin</span>}
    </Link>
  );
}
