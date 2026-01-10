import { Context, ConnectorError, ConnectorErrorType } from '@sailpoint/connector-sdk'
import { FusionConfig } from '../model/config'
import { LogService } from './logService'
import { InMemoryLockService, LockService } from './lockService'
import { ClientService } from './clientService'
import { SourceService } from './sourceService'
import { FusionService } from './fusionService'
import { IdentityService } from './identityService'
import { SchemaService } from './schemaService'
import { FormService } from './formService'
import { AttributeService } from './attributeService'
import { EntitlementService } from './entitlementService'
import { ScoringService } from './scoringService'

export class ServiceRegistry {
    private static current?: ServiceRegistry
    public log: LogService
    public locks: LockService
    public client: ClientService
    public sources: SourceService
    public fusion: FusionService
    public identities: IdentityService
    public schemas: SchemaService
    public forms: FormService
    public attributes: AttributeService
    public entitlements: EntitlementService
    public scoring: ScoringService

    constructor(
        public config: FusionConfig,
        private context: Context
    ) {
        // Initialize core services first
        this.log = context.logService ?? new LogService(this.config)
        this.locks = context.lockService ?? new InMemoryLockService(this.log)
        this.client = context.connectionService ?? new ClientService(this.config, this.log)

        // Initialize services that don't depend on others
        this.sources = context.sourceService ?? new SourceService(this.config, this.log, this.client)
        this.entitlements = context.entitlementService ?? new EntitlementService(this.log, this.sources)
        this.scoring = context.scoringService ?? new ScoringService(this.config, this.log)
        this.identities = context.identityService ?? new IdentityService(this.config, this.log, this.client)
        this.forms = context.formService ?? new FormService(this.config, this.log, this.client)

        // Initialize services that depend on others (in dependency order)
        this.schemas = context.schemaService ?? new SchemaService(this.config, this.log, this.sources)
        this.attributes =
            context.attributesService ??
            new AttributeService(this.config, this.schemas, this.sources, this.log, this.locks)

        // Initialize FusionService last (depends on multiple services)
        this.fusion =
            context.fusionService ??
            new FusionService(
                this.config,
                this.log,
                this.identities,
                this.sources,
                this.forms,
                this.attributes,
                this.scoring,
                this.schemas
            )
    }

    static setCurrent(reg: ServiceRegistry) {
        this.current = reg
    }
    static getCurrent(): ServiceRegistry {
        if (!this.current) {
            throw new ConnectorError('ServiceRegistry not found', ConnectorErrorType.Generic)
        }
        return this.current!
    }

    static clear() {
        this.current = undefined
    }

    static getLogService(): LogService {
        return this.getCurrent().log
    }
}
