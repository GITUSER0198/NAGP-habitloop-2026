import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AwsStore } from '../src/store.js';

describe('DynamoDB analytics adapter', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('reads streaks consistently and forwards the cancellation signal', async () => {
    const item = { PK: 'tenant-user', SK: 'STREAK', current: 2 };
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockResolvedValue({ Item: item } as never);
    const signal = new AbortController().signal;
    expect(await new AwsStore().get(item.PK, item.SK, signal)).toEqual(item);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({ Key: { PK: item.PK, SK: item.SK }, ConsistentRead: true });
    expect(send.mock.calls[0][1]).toEqual({ abortSignal: signal });
  });
  it('returns undefined for a missing item', async () => {
    vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockResolvedValue({} as never);
    expect(await new AwsStore().get('tenant-user', 'STREAK')).toBeUndefined();
  });
  it('collects all query pages with a tenant partition and prefix, including an empty intermediate page', async () => {
    const cursor = { PK: 'tenant-user', SK: 'DAY#2026-11-19' };
    const next = { PK: 'tenant-user', SK: 'DAY#2026-11-20' };
    const first = { ...cursor, done: 1 }; const last = { PK: 'tenant-user', SK: 'DAY#2026-11-21', completed: 1 };
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send')
      .mockResolvedValueOnce({ Items: [first], LastEvaluatedKey: cursor } as never)
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: next } as never)
      .mockResolvedValueOnce({ Items: [last] } as never);
    const signal = new AbortController().signal;
    expect(await new AwsStore().query('tenant-user', 'DAY#', signal)).toEqual([first, last]);
    expect(send).toHaveBeenCalledTimes(3);
    for (const [command, options] of send.mock.calls) {
      expect(command).toBeInstanceOf(QueryCommand);
      expect(command.input).toMatchObject({ KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': 'tenant-user', ':prefix': 'DAY#' }, ConsistentRead: true });
      expect(options).toEqual({ abortSignal: signal });
    }
    expect(send.mock.calls[1][0].input).toHaveProperty('ExclusiveStartKey', cursor);
    expect(send.mock.calls[2][0].input).toHaveProperty('ExclusiveStartKey', next);
  });
  it('uses the local endpoint, configured region, and configured table', async () => {
    vi.stubEnv('DYNAMODB_ENDPOINT', 'http://dynamodb-local:47820'); vi.stubEnv('AWS_REGION', 'ap-south-1'); vi.stubEnv('DYNAMODB_TABLE', 'test-analytics');
    const from = vi.spyOn(DynamoDBDocumentClient, 'from');
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockResolvedValue({} as never);
    await new AwsStore().get('tenant-user', 'STREAK');
    const client = from.mock.calls[0][0];
    expect(await client.config.endpoint!()).toMatchObject({ protocol: 'http:', hostname: 'dynamodb-local', port: 47820 });
    expect(await client.config.region()).toBe('ap-south-1'); expect(send.mock.calls[0][0].input).toHaveProperty('TableName', 'test-analytics');
  });
});
