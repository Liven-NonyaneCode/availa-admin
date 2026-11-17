import { useSearchParams } from "react-router-dom";

/**
 * The user and booking panels open from anywhere (a table row, a link in another panel)
 * and live in the address bar as ?user=ID and ?booking=ID, so a link to one can be shared
 * with a teammate and the back button closes it.
 */
export function useOverlay() {
  const [params, setParams] = useSearchParams();

  function set(key: "user" | "booking", id: string | null) {
    const next = new URLSearchParams(params);
    if (id) next.set(key, id);
    else next.delete(key);
    setParams(next);
  }

  return {
    userId: params.get("user"),
    bookingId: params.get("booking"),
    openUser: (id: string) => set("user", id),
    openBooking: (id: string) => set("booking", id),
    closeUser: () => set("user", null),
    closeBooking: () => set("booking", null),
  };
}
