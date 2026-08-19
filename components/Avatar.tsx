import { initials } from "@/lib/utils";

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

export function Avatar({
  name,
  url,
  size = "md",
  showOnlineDot = false,
  online = false,
}: {
  name: string;
  url?: string | null;
  size?: keyof typeof SIZES;
  showOnlineDot?: boolean;
  online?: boolean;
}) {
  const sizeClass = SIZES[size];
  return (
    <div className="relative shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          className={`${sizeClass} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${sizeClass} flex items-center justify-center rounded-full bg-emerald-500 font-semibold text-white`}
        >
          {initials(name)}
        </div>
      )}
      {showOnlineDot && (
        <span
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white ${
            online ? "bg-green-500" : "bg-gray-300"
          }`}
        />
      )}
    </div>
  );
}
