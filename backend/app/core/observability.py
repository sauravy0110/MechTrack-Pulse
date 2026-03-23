"""
MechTrack Pulse — OpenTelemetry Observability

WHY: Implement distributed tracing to track requests across:
FastAPI → Redis → SQLAlchemy → WebSockets.
"""

try:
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.instrumentation.redis import RedisInstrumentor
    from opentelemetry.sdk.resources import RESOURCE_ATTRIBUTES, Resource
    OTEL_AVAILABLE = True
except ImportError:
    OTEL_AVAILABLE = False

def setup_tracing(app=None, engine=None):
    """
    Initialize OpenTelemetry tracing.
    
    Args:
        app: FastAPI application instance for instrumentation.
        engine: SQLAlchemy engine for instrumentation.
    """
    if not OTEL_AVAILABLE:
        return None

    # 1. Define Resource (Service Name)
    resource = Resource(attributes={
        RESOURCE_ATTRIBUTES.SERVICE_NAME: "mechtrack-pulse-backend"
    })

    # 2. Setup Tracer Provider
    provider = TracerProvider(resource=resource)
    
    # 3. Add Console Exporter (for production you'd use OTLP)
    # Batch is better for performance
    console_exporter = ConsoleSpanExporter()
    processor = BatchSpanProcessor(console_exporter)
    provider.add_span_processor(processor)
    
    # Set global tracer
    trace.set_tracer_provider(provider)

    # 4. Instrument FastAPI
    if app:
        FastAPIInstrumentor.instrument_app(app)

    # 5. Instrument SQLAlchemy
    if engine:
        SQLAlchemyInstrumentor().instrument(engine=engine)

    # 6. Instrument Redis
    # RedisInstrumentor is usually global/automatic but can be explicitly called
    RedisInstrumentor().instrument()

    return provider
