import { useState, useRef, type FC } from "hono/jsx/dom";

type StarType = "full" | "half" | "empty";

interface StarRatingProps {
  initialRating?: number;
  onChange?: (rating: number) => void;
}

export function calculateStars(rating: number): StarType[] {
  const stars: StarType[] = [];
  const fullStars = Math.floor(rating / 2);
  const hasHalfStar = rating % 2 !== 0;

  for (let i = 0; i < fullStars; i++) {
    stars.push("full");
  }
  if (hasHalfStar) stars.push("half");
  while (stars.length < 5) stars.push("empty");

  return stars;
}

export const StarRating: FC<StarRatingProps> = ({
  initialRating = 0,
  onChange,
}) => {
  const [rating, setRating] = useState(initialRating);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const calculateRatingFromEvent = (event: MouseEvent): number => {
    if (!containerRef.current) return 0;

    const rect = containerRef.current.getBoundingClientRect();
    const starWidth = rect.width / 5;
    const x = event.clientX - rect.left;

    const starIndex = Math.floor(x / starWidth);
    const starPosition = (x % starWidth) / starWidth;

    let newRating = starIndex * 2;
    if (starPosition > 0) {
      newRating += starPosition < 0.5 ? 1 : 2;
    }

    return Math.max(0, Math.min(10, newRating));
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isDragging) {
      setHoverRating(calculateRatingFromEvent(event));
    }
  };

  const handleMouseLeave = () => {
    if (!isDragging) {
      setHoverRating(null);
    }
  };

  const handleMouseDown = (event: MouseEvent) => {
    setIsDragging(true);
    const newRating = calculateRatingFromEvent(event);
    setRating(newRating);
    onChange?.(newRating);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const displayRating = hoverRating ?? rating;
  const stars = calculateStars(displayRating);

  return (
    <div className="flex items-center gap-3">
      <div
        ref={containerRef}
        className="inline-flex cursor-pointer items-center space-x-1 select-none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {stars.map((type, index) => {
          const baseClasses = "w-8 h-8 transition-colors duration-150";
          if (type === "full") {
            return (
              <svg
                key={index}
                className={`${baseClasses} text-yellow-400`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            );
          } else if (type === "half") {
            return (
              <svg
                key={index}
                className={`${baseClasses} text-yellow-400`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <defs>
                  <linearGradient id={`half-${index}`}>
                    <stop offset="50%" stopColor="currentColor" />
                    <stop offset="50%" stopColor="#e5e7eb" />
                  </linearGradient>
                </defs>
                <path
                  fill={`url(#half-${index})`}
                  d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                />
              </svg>
            );
          } else {
            return (
              <svg
                key={index}
                className={`${baseClasses} text-gray-200`}
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            );
          }
        })}
      </div>
      <div className="mt-1 w-10 text-lg dark:text-gray-100">
        {hoverRating ? `${hoverRating / 2}` : ""}
      </div>
    </div>
  );
};
