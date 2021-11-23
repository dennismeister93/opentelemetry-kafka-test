import { Kafka, KafkaMessage } from 'kafkajs';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import * as opentelemetryapi from '@opentelemetry/api';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

opentelemetryapi.propagation.setGlobalPropagator(new B3Propagator());

const options = {
    serviceName: 'testService',
    endpoint: 'http://localhost:14268/api/traces',
};

const traceProvider = new NodeTracerProvider({
    resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'my-service',
    }),
});

const exporter = new JaegerExporter(options);

traceProvider.addSpanProcessor(new BatchSpanProcessor(exporter) as any);
traceProvider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()) as any);
traceProvider.register();

registerInstrumentations({
    tracerProvider: traceProvider,
    instrumentations: [getNodeAutoInstrumentations()],
});
const tracer = opentelemetryapi.trace.getTracer('testTracer');

const kafka = new Kafka({
    clientId: 'my-app',
    brokers: ['localhost:29092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'test-group' });

const handleMessage = (message: KafkaMessage) => {
    const b3header = { b3: message.headers.b3.toString() };
    const b3propagationContext = opentelemetryapi.propagation.extract(
        opentelemetryapi.context.active(),
        b3header,
        opentelemetryapi.defaultTextMapGetter
    );

    console.log('Extracted context from b3 carrier received from kafka message');
    console.log(b3propagationContext);

    const extractedSpan = opentelemetryapi.trace.getSpan(b3propagationContext);
    console.log('Span from extracted context from b3 carrier received from kafka message');
    console.log(extractedSpan);

    const ctx = opentelemetryapi.trace.setSpan(opentelemetryapi.context.active(), extractedSpan);

    const span = tracer.startSpan('handleMessage', undefined, ctx);

    console.log('Freshly created Span with context from b3 carrier received from kafka message');
    console.log(span);

    span.end();
};

const run = async () => {
    // Producing
    await producer.connect();
    setInterval(async () => {
        await producer.send({
            topic: 'test-topic',
            messages: [
                {
                    value: 'Hello KafkaJS user!',
                    headers: {
                        b3: 'a2202b400feeec6e-c86b4cce85426774-0',
                    },
                },
            ],
        });
    }, 5000);

    // Consuming
    await consumer.connect();
    await consumer.subscribe({ topic: 'test-topic', fromBeginning: true });

    await consumer.run({
        eachMessage: async ({ message }: { message: KafkaMessage }) => {
            handleMessage(message);
        },
    });
};

const test = () => {
    const propagator = new B3Propagator();
    const b3SingleCarrier = {
        b3: '80f198ee56343ba864fe8b2a57d3eff7-e457b5a2e4d86bd1-0',
    };
    const context = propagator.extract(opentelemetryapi.context.active(), b3SingleCarrier, opentelemetryapi.defaultTextMapGetter);
    console.log('Extracted context from b3 carrier without receiving it from kafka message');
    console.log(context);

    const extractedSpanContext = opentelemetryapi.trace.getSpanContext(context);
    console.log('SpanContext from extracted context from b3 carrier without receiving it from kafka message');
    console.log(extractedSpanContext);

    const span = tracer.startSpan('newTestSpan', undefined, context);
    console.log('Freshly created Span with context from b3 carrier without receiving it from kafka message');
    console.log(span);

    span.end();
};

run().catch(console.error);

test();
