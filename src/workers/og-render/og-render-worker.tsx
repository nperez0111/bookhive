/** @jsxImportSource react */
declare var self: Worker;

import ImageResponse from "@takumi-rs/image-response";
import type { OgRenderRequest, OgRenderResponse } from "./types";
import {
  BookOgCard,
  StatsOgCard,
  ProfileOgCard,
  LabeledCoverCard,
  MarketingOgCard,
  AppOgCard,
  OG_RENDER_OPTIONS,
} from "./components";

self.onmessage = async (event: MessageEvent<OgRenderRequest>) => {
  const { id, card } = event.data;
  try {
    let jsx: React.ReactElement;
    switch (card.kind) {
      case "book":
        jsx = <BookOgCard {...card.props} />;
        break;
      case "stats":
        jsx = <StatsOgCard {...card.props} />;
        break;
      case "profile":
        jsx = <ProfileOgCard {...card.props} />;
        break;
      case "labeled-cover":
        jsx = <LabeledCoverCard {...card.props} />;
        break;
      case "marketing":
        jsx = <MarketingOgCard {...card.props} />;
        break;
      case "app":
        jsx = <AppOgCard {...card.props} />;
        break;
    }

    const response = new ImageResponse(jsx, OG_RENDER_OPTIONS);
    const buffer = await response.arrayBuffer();

    const msg: OgRenderResponse = { type: "render-result", id, ok: true, buffer };
    self.postMessage(msg, [buffer]); // zero-copy transfer
  } catch (err) {
    const msg: OgRenderResponse = {
      type: "render-result",
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};
