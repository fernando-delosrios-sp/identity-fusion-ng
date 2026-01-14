import { ServiceRegistry } from '../../services/serviceRegistry'
import { FusionAccount } from '../../model/account'

export const generateReport = async (fusionAccount: FusionAccount, serviceRegistry?: ServiceRegistry) => {
    if (!serviceRegistry) {
        serviceRegistry = ServiceRegistry.getCurrent()
    }
    const { fusion, identities, sources, messaging } = serviceRegistry

    const fetchPromises = [
        messaging.fetchSender(),
        sources.fetchFusionAccounts(),
        identities.fetchIdentities(),
        sources.fetchManagedAccounts(),
    ]

    await Promise.all(fetchPromises)

    await fusion.processFusionAccounts()
    await fusion.processIdentities()

    identities.clear()

    await fusion.analyzeManagedAccounts()
    const report = fusion.generateReport()
    await messaging.sendReport(report, fusionAccount)
}
