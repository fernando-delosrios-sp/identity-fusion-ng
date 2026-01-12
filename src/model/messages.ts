// ============================================================================
// Email Template Definitions
// ============================================================================

/**
 * Email template for fusion review notifications
 */
export const FUSION_REVIEW_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Identity Fusion Review Required</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 3px solid #0066cc;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #0066cc;
            margin: 0;
            font-size: 24px;
        }
        .section {
            margin-bottom: 25px;
        }
        .section-title {
            color: #0066cc;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e0e0e0;
        }
        .info-row {
            display: flex;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .info-label {
            font-weight: 600;
            color: #666;
            min-width: 120px;
        }
        .info-value {
            color: #333;
            flex: 1;
        }
        .candidates-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .candidate-item {
            background-color: #f8f9fa;
            border-left: 4px solid #0066cc;
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 4px;
        }
        .candidate-name {
            font-weight: 600;
            color: #0066cc;
            margin-bottom: 5px;
        }
        .candidate-id {
            color: #666;
            font-size: 14px;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #e0e0e0;
            color: #666;
            font-size: 14px;
            text-align: center;
        }
        .button {
            display: inline-block;
            padding: 12px 24px;
            background-color: #0066cc;
            color: #ffffff;
            text-decoration: none;
            border-radius: 4px;
            margin-top: 20px;
            font-weight: 600;
        }
        .no-candidates {
            color: #999;
            font-style: italic;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Identity Fusion Review Required</h1>
        </div>

        <div class="section">
            <div class="section-title">Account Information</div>
            <div class="info-row">
                <div class="info-label">Name:</div>
                <div class="info-value">{{accountName}}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Source:</div>
                <div class="info-value">{{accountSource}}</div>
            </div>
            {{#each accountAttributes}}
            <div class="info-row">
                <div class="info-label">{{@key}}:</div>
                <div class="info-value">{{formatAttribute this}}</div>
            </div>
            {{/each}}
        </div>

        <div class="section">
            <div class="section-title">Potential Matches</div>
            {{#if candidates}}
                {{#if (gt candidates.length 0)}}
                    <ul class="candidates-list">
                        {{#each candidates}}
                        <li class="candidate-item">
                            <div class="candidate-name">{{name}}</div>
                            <div class="candidate-id">ID: {{id}}</div>
                            {{#if scores}}
                            <div style="margin-top: 8px; font-size: 12px; color: #666;">
                                Scores: {{formatScores scores}}
                            </div>
                            {{/if}}
                        </li>
                        {{/each}}
                    </ul>
                {{else}}
                    <div class="no-candidates">No potential matches found.</div>
                {{/if}}
            {{else}}
                <div class="no-candidates">No potential matches found.</div>
            {{/if}}
        </div>

        <div class="section">
            <p style="color: #333; margin: 0;">
                Please review this account and decide whether to create a new identity or link it to an existing one.
            </p>
            {{#if formInstanceId}}
            <p style="color: #666; font-size: 14px; margin-top: 10px;">
                Form Instance ID: <code>{{formInstanceId}}</code>
            </p>
            {{/if}}
        </div>

        <div class="footer">
            <p style="margin: 0;">Thank you,<br>Identity Fusion Connector</p>
        </div>
    </div>
</body>
</html>
`

/**
 * Email template for edit request notifications
 */
export const EDIT_REQUEST_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Edit Request</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 3px solid #0066cc;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #0066cc;
            margin: 0;
            font-size: 24px;
        }
        .section {
            margin-bottom: 25px;
        }
        .section-title {
            color: #0066cc;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e0e0e0;
        }
        .info-row {
            display: flex;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        .info-label {
            font-weight: 600;
            color: #666;
            min-width: 120px;
        }
        .info-value {
            color: #333;
            flex: 1;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #e0e0e0;
            color: #666;
            font-size: 14px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Account Edit Request</h1>
        </div>

        <div class="section">
            <div class="section-title">Account Information</div>
            <div class="info-row">
                <div class="info-label">Name:</div>
                <div class="info-value">{{accountName}}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Source:</div>
                <div class="info-value">{{accountSource}}</div>
            </div>
            {{#each accountAttributes}}
            <div class="info-row">
                <div class="info-label">{{@key}}:</div>
                <div class="info-value">{{formatAttribute this}}</div>
            </div>
            {{/each}}
        </div>

        <div class="section">
            <p style="color: #333; margin: 0;">
                Please review and update the account information as needed.
            </p>
            {{#if formInstanceId}}
            <p style="color: #666; font-size: 14px; margin-top: 10px;">
                Form Instance ID: <code>{{formInstanceId}}</code>
            </p>
            {{/if}}
        </div>

        <div class="footer">
            <p style="margin: 0;">Thank you,<br>Identity Fusion Connector</p>
        </div>
    </div>
</body>
</html>
`

/**
 * Email template for fusion report notifications
 */
export const FUSION_REPORT_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Identity Fusion Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: #ffffff;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 3px solid #0066cc;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .header h1 {
            color: #0066cc;
            margin: 0;
            font-size: 24px;
        }
        .summary {
            background-color: #f8f9fa;
            border-left: 4px solid #0066cc;
            padding: 15px;
            margin-bottom: 30px;
            border-radius: 4px;
        }
        .summary-item {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
        }
        .summary-label {
            font-weight: 600;
            color: #666;
        }
        .summary-value {
            color: #333;
        }
        .account-section {
            margin-bottom: 40px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            background-color: #fafafa;
        }
        .account-header {
            border-bottom: 2px solid #0066cc;
            padding-bottom: 15px;
            margin-bottom: 20px;
        }
        .account-name {
            color: #0066cc;
            font-size: 20px;
            font-weight: 600;
            margin: 0 0 10px 0;
        }
        .account-info {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            font-size: 14px;
            color: #666;
        }
        .account-info-item {
            display: flex;
            gap: 5px;
        }
        .account-info-label {
            font-weight: 600;
        }
        .section {
            margin-bottom: 25px;
        }
        .section-title {
            color: #0066cc;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #e0e0e0;
        }
        .match-item {
            background-color: #ffffff;
            border: 1px solid #e0e0e0;
            border-left: 4px solid #0066cc;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .match-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .match-name {
            font-size: 18px;
            font-weight: 600;
            color: #0066cc;
        }
        .match-status {
            padding: 5px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .match-status.match {
            background-color: #d4edda;
            color: #155724;
        }
        .match-status.no-match {
            background-color: #f8d7da;
            color: #721c24;
        }
        .scores-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .scores-table th {
            background-color: #f8f9fa;
            padding: 10px;
            text-align: left;
            font-weight: 600;
            color: #666;
            border-bottom: 2px solid #e0e0e0;
        }
        .scores-table td {
            padding: 10px;
            border-bottom: 1px solid #f0f0f0;
        }
        .scores-table tr:hover {
            background-color: #f8f9fa;
        }
        .score-value {
            font-weight: 600;
        }
        .score-value.high {
            color: #28a745;
        }
        .score-value.medium {
            color: #ffc107;
        }
        .score-value.low {
            color: #dc3545;
        }
        .match-badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .match-badge.yes {
            background-color: #d4edda;
            color: #155724;
        }
        .match-badge.no {
            background-color: #f8d7da;
            color: #721c24;
        }
        .no-matches {
            color: #999;
            font-style: italic;
            padding: 20px;
            background-color: #f8f9fa;
            border-radius: 4px;
            text-align: center;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #e0e0e0;
            color: #666;
            font-size: 14px;
            text-align: center;
        }
        .attributes-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 10px;
            margin-top: 15px;
        }
        .attribute-item {
            padding: 8px;
            background-color: #f8f9fa;
            border-radius: 4px;
            font-size: 13px;
        }
        .attribute-label {
            font-weight: 600;
            color: #666;
            margin-bottom: 3px;
        }
        .attribute-value {
            color: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Identity Fusion Report</h1>
        </div>

        <div class="summary">
            <div class="summary-item">
                <span class="summary-label">Report Date:</span>
                <span class="summary-value">{{formatDate reportDate}}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Accounts Analyzed:</span>
                <span class="summary-value">{{totalAccounts}}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Potential Duplicates Found:</span>
                <span class="summary-value">{{potentialDuplicates}}</span>
            </div>
            {{#if accountName}}
            <div class="summary-item">
                <span class="summary-label">Account:</span>
                <span class="summary-value">{{accountName}}</span>
            </div>
            {{/if}}
        </div>

        {{#each accounts}}
        <div class="account-section">
            <div class="account-header">
                <div class="account-name">{{accountName}}</div>
                <div class="account-info">
                    <div class="account-info-item">
                        <span class="account-info-label">Source:</span>
                        <span>{{accountSource}}</span>
                    </div>
                    {{#if accountId}}
                    <div class="account-info-item">
                        <span class="account-info-label">ID:</span>
                        <span>{{accountId}}</span>
                    </div>
                    {{/if}}
                    {{#if accountEmail}}
                    <div class="account-info-item">
                        <span class="account-info-label">Email:</span>
                        <span>{{accountEmail}}</span>
                    </div>
                    {{/if}}
                </div>
            </div>

            {{#if accountAttributes}}
            <div class="section">
                <div class="section-title">Account Attributes</div>
                <div class="attributes-grid">
                    {{#each accountAttributes}}
                    <div class="attribute-item">
                        <div class="attribute-label">{{@key}}</div>
                        <div class="attribute-value">{{formatAttribute this}}</div>
                    </div>
                    {{/each}}
                </div>
            </div>
            {{/if}}

            <div class="section">
                <div class="section-title">Potential Matches</div>
                {{#if matches}}
                    {{#if (gt matches.length 0)}}
                        {{#each matches}}
                        <div class="match-item">
                            <div class="match-header">
                                <div class="match-name">{{identityName}}</div>
                                <span class="match-status {{#if isMatch}}match{{else}}no-match{{/if}}">
                                    {{#if isMatch}}Match{{else}}No Match{{/if}}
                                </span>
                            </div>
                            {{#if identityId}}
                            <div style="font-size: 14px; color: #666; margin-bottom: 10px;">
                                Identity ID: {{identityId}}
                            </div>
                            {{/if}}
                            {{#if scores}}
                            <table class="scores-table">
                                <thead>
                                    <tr>
                                        <th>Attribute</th>
                                        <th>Algorithm</th>
                                        <th>Score</th>
                                        <th>Threshold</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {{#each scores}}
                                    <tr>
                                        <td>{{attribute}}</td>
                                        <td>{{algorithm}}</td>
                                        <td>
                                            <span class="score-value {{#if (gte score 80)}}high{{else}}{{#if (gte score 50)}}medium{{else}}low{{/if}}{{/if}}">
                                                {{score}}%
                                            </span>
                                        </td>
                                        <td>{{fusionScore}}%</td>
                                        <td>
                                            <span class="match-badge {{#if isMatch}}yes{{else}}no{{/if}}">
                                                {{#if isMatch}}Match{{else}}No Match{{/if}}
                                            </span>
                                        </td>
                                    </tr>
                                    {{/each}}
                                </tbody>
                            </table>
                            {{/if}}
                        </div>
                        {{/each}}
                    {{else}}
                        <div class="no-matches">No potential matches found for this account.</div>
                    {{/if}}
                {{else}}
                    <div class="no-matches">No potential matches found for this account.</div>
                {{/if}}
            </div>
        </div>
        {{/each}}

        {{#unless accounts}}
        <div class="no-matches" style="margin: 40px 0;">
            No accounts with potential duplicates found in this report.
        </div>
        {{/unless}}

        <div class="footer">
            <p style="margin: 0;">
                This report was generated by the Identity Fusion Connector.<br>
                Please review the potential duplicates and take appropriate action.
            </p>
        </div>
    </div>
</body>
</html>
`
