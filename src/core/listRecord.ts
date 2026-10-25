/** Fields shared by every list-record mirror writer; never use this to shape a PDS write. */
export function listRecordFields(record: {
  name: string;
  description?: string;
  ordered?: boolean;
  itemOrder?: string[];
  tags?: string[];
  createdAt: string;
}) {
  return {
    name: record.name,
    description: record.description ?? null,
    ordered: record.ordered ? 1 : 0,
    itemOrder: record.itemOrder ? JSON.stringify(record.itemOrder) : null,
    tags: record.tags ? JSON.stringify(record.tags) : null,
    createdAt: record.createdAt,
  };
}
