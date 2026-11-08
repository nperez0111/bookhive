/** Best-effort bounded shipping; stdout is independent and remains authoritative. */
import { OpenObserveSender, type LogMessage, type OpenObserveOptions } from "../logger/openObserve";

let sender: OpenObserveSender | undefined;

self.onmessage = (
  event: MessageEvent<{ type: "init"; options: OpenObserveOptions } | LogMessage>,
) => {
  const message = event.data;
  if (message.type === "init") {
    sender ??= new OpenObserveSender(message.options, {
      reply: (reply) => self.postMessage(reply),
      // Structured stdout only: never recursively feed shipper failures into this queue.
      log: (level, msg, fields) =>
        console.log(
          JSON.stringify({
            level,
            time: Date.now(),
            name: "open-observe",
            msg,
            ...fields,
          }),
        ),
    });
  } else sender?.enqueue(message);
};
