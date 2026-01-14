import { ActionSource } from '../model/action'

export const actions: ActionSource[] = [
    { id: 'reset', name: 'Reset unique ID', description: "Reset the account's unique ID " },
    { id: 'report', name: 'Fusion report', description: 'Generate fusion report' },
    { id: 'fusion', name: 'Fusion account', description: 'Create a fusion account' },
    { id: 'correlate', name: 'Correlate accounts', description: 'Correlate missing source accounts' },
]
