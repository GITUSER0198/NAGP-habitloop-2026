import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

export type Item = Record<string, unknown> & { PK: string; SK: string };
export interface AnalyticsStore { get(pk: string, sk: string, signal?: AbortSignal): Promise<Item | undefined>; query(pk: string, prefix: string, signal?: AbortSignal): Promise<Item[]> }
export class AwsStore implements AnalyticsStore {
  private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? 'ap-south-1',
    ...(process.env.DYNAMODB_ENDPOINT ? { endpoint: process.env.DYNAMODB_ENDPOINT } : {}) }), { marshallOptions: { removeUndefinedValues: true } });
  async get(pk: string, sk: string, signal?: AbortSignal): Promise<Item | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: process.env.DYNAMODB_TABLE ?? 'habitloop-analytics', Key: { PK: pk, SK: sk }, ConsistentRead: true }), { abortSignal: signal });
    return result.Item as Item | undefined;
  }
  async query(pk: string, prefix: string, signal?: AbortSignal): Promise<Item[]> {
    const items: Item[] = []; let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({ TableName: process.env.DYNAMODB_TABLE ?? 'habitloop-analytics',
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': pk, ':prefix': prefix },
        ConsistentRead: true, ExclusiveStartKey: cursor }), { abortSignal: signal });
      items.push(...(result.Items as Item[] ?? [])); cursor = result.LastEvaluatedKey;
    } while (cursor);
    return items;
  }
}
let injected: AnalyticsStore | undefined;
export function getAnalyticsStore(): AnalyticsStore { return injected ?? new AwsStore(); }
export function setAnalyticsStoreForTests(store?: AnalyticsStore): void { injected = store; }
