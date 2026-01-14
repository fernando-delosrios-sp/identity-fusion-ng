type Attributes = { [key: string]: any }

type Account = {
    id: string
    name: string
    sourceName: string
    attributes: Attributes
    score?: Score
}

type User = {
    id: string
    email: string
    name: string
}

type Score = {
    attributes: { attribute: string; score: number; threshold: number }[]
    score: number
    threshold: number
}

export type FusionDecision = {
    submitter: User
    account: Account
    newIdentity: boolean
    identityId?: string
    comments: string
}
export type FusionRequest = {
    title: string
    recipient: User
    account: Account
    candidates: Account[]
}
