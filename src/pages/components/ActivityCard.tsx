import type { FC } from "hono/jsx";
import { Card, CardBody, UserBlock, BookBlock, CardActions, StarCount } from "./cards";

export type FeedActivity = {
  uri: string;
  userDid: string;
  hiveId: string;
  title: string;
  authors: string;
  status: string | null;
  stars: number | null;
  review: string | null;
  createdAt: string;
  cover: string | null;
  thumbnail: string | null;
};

export type FeedActivityUser = {
  handle: string;
  displayName?: string | null;
  avatar?: string | null;
};

function getActionText(status: string | null): string {
  if (!status) return "updated";
  if (status.includes("finished")) return "finished reading";
  if (status.includes("reading")) return "started reading";
  if (status.includes("abandoned")) return "abandoned";
  if (status.includes("wantToRead")) return "wants to read";
  return "updated";
}

function getShareText(activity: FeedActivity, handle: string): string {
  const title = activity.title;
  const authorList = activity.authors?.replace(/\t/g, ", ") ?? "";
  return `I just finished "${title}"${authorList ? ` by ${authorList}` : ""} on BookHive!\n\nbookhive.buzz/books/${activity.hiveId}`;
}

export interface ActivityCardProps {
  activity: FeedActivity;
  user: FeedActivityUser;
  timeAgo: string;
}

export const ActivityCard: FC<ActivityCardProps> = ({ activity, user, timeAgo }) => {
  const actionText = getActionText(activity.status);
  const shareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(getShareText(activity, user.handle))}`;
  const starDisplay = activity.stars != null ? activity.stars / 2 : 0;

  return (
    <Card>
      <CardBody class="space-y-3">
        <UserBlock
          handle={user.handle}
          displayName={user.displayName}
          avatar={user.avatar}
          size="md"
          suffix={timeAgo}
        />

        <div class="text-sm">
          <span class="font-semibold">@{user.handle}</span>
          <span class="text-muted-foreground"> {actionText} </span>
          <a
            href={`/books/${activity.hiveId}`}
            class="text-foreground hover:text-primary font-semibold"
          >
            "{activity.title}"
          </a>
          {starDisplay > 0 && (
            <div class="mt-1">
              <StarCount count={starDisplay} />
            </div>
          )}
        </div>

        {activity.review && (
          <p class="text-muted-foreground line-clamp-3 text-sm italic">
            "{activity.review}"
          </p>
        )}

        <div class="bg-muted rounded p-3">
          <BookBlock
            hiveId={activity.hiveId}
            title={activity.title}
            authors={activity.authors}
            cover={activity.cover}
            thumbnail={activity.thumbnail}
            size="compact"
            stars={activity.stars}
          />
        </div>

        <CardActions>
          <a
            href={shareUrl}
            class="btn btn-sm btn-ghost"
            target="_blank"
            rel="noopener noreferrer"
          >
            Share
          </a>
        </CardActions>
      </CardBody>
    </Card>
  );
};
