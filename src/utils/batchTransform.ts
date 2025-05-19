export function createBatchTransform<T, R>(
  batchSize: number,
  processBatch: (items: T[]) => Promise<R>,
  onBatchComplete?: (processedCount: number) => void,
): TransformStream<T, R> {
  let batch: T[] = [];
  let totalProcessed = 0;

  return new TransformStream<T, R>({
    transform(item, controller) {
      batch.push(item);

      if (batch.length >= batchSize) {
        return processBatch(batch).then((result) => {
          controller.enqueue(result);
          totalProcessed += batch.length;
          onBatchComplete?.(totalProcessed);
          batch = [];
        });
      }
    },

    flush(controller) {
      if (batch.length > 0) {
        return processBatch(batch).then((result) => {
          controller.enqueue(result);
          totalProcessed += batch.length;
          onBatchComplete?.(totalProcessed);
          batch = [];
        });
      }
    },
  });
}

// // Usage with progress updates
// uploadStream.pipeThrough(
//   createBatchTransform(
//     100,
//     async (books) => {
//       // Your batch processing logic
//     },
//     (processedCount) => {
//       console.log(`Processed ${processedCount} books so far`);
//     },
//   ),
// );
