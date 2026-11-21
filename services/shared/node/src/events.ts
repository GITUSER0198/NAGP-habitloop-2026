import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getConfig } from './config.js';
import { getServiceName } from './logger.js';

export async function publish(detailType: string, detail: Record<string, unknown>): Promise<void> {
  const cfg = getConfig();
  const source = `habitloop.${getServiceName().replace(/-service$/, '')}`;
  if (cfg.eventBusMode === 'local') {
    const response = await fetch(cfg.eventWorkerUrl, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-internal-token': cfg.internalToken
    }, body: JSON.stringify({ source, 'detail-type': detailType, detail }) });
    if (!response.ok) throw new Error(`Local event worker returned ${response.status}`);
    return;
  }
  const result = await new EventBridgeClient({ region: cfg.awsRegion }).send(new PutEventsCommand({ Entries: [{
    Source: source, DetailType: detailType, Detail: JSON.stringify(detail), EventBusName: cfg.eventBusName
  }] }));
  if (result.FailedEntryCount) throw new Error('EventBridge failed to publish event');
}
