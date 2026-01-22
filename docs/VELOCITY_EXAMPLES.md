# Velocity Expressions - Practical Examples

Real-world examples of Velocity expressions for the Identity Fusion NG connector.

## Table of Contents

1. [Username Generation](#username-generation)
2. [Employee ID Generation](#employee-id-generation)
3. [Display Name Formatting](#display-name-formatting)
4. [Multi-Source Data Integration](#multi-source-data-integration)
5. [Date and Time Operations](#date-and-time-operations)
6. [Contact Information Normalization](#contact-information-normalization)
7. [Location-Based Attributes](#location-based-attributes)
8. [Conditional Logic Scenarios](#conditional-logic-scenarios)
9. [Data Validation and Cleanup](#data-validation-and-cleanup)
10. [Advanced Patterns](#advanced-patterns)

---

## Username Generation

### Example 1: Standard firstname.lastname

**Scenario:** Generate usernames in the format `firstname.lastname` with automatic counter for duplicates.

**Expression:**
```velocity
${firstName}.${lastName}
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`
- Remove Spaces: `No`

**Sample Input/Output:**
| First Name | Last Name | Output |
|------------|-----------|--------|
| John | Doe | `john.doe` |
| Jane | O'Brien | `jane.obrien` |
| José | García | `jose.garcia` |
| John | Doe | `john.doe1` (duplicate) |

---

### Example 2: firstInitial + lastName

**Scenario:** Generate usernames using first initial and full last name.

**Expression:**
```velocity
${firstName.substring(0,1)}${lastName}
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`

**Sample Output:**
- `jdoe`, `jsmith`, `mobrien`

---

### Example 3: Email Prefix as Username

**Scenario:** Extract username from email address.

**Expression:**
```velocity
#set($parts = $email.split('@'))
#if($parts.size() > 0)
$parts[0]
#else
unknown
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`

**Sample Input/Output:**
| Email | Output |
|-------|--------|
| john.smith@company.com | `john.smith` |
| jdoe@company.com | `jdoe` |

---

### Example 4: Department-Based Username Format

**Scenario:** Different username formats for different departments.

**Expression:**
```velocity
#if($department == 'IT' || $department == 'Engineering')
${firstName}.${lastName}
#elseif($department == 'HR' || $department == 'Finance')
${firstName}${lastName.substring(0,1)}
#else
${firstName.substring(0,1)}${lastName}
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`

**Sample Output:**
| Name | Department | Output |
|------|------------|--------|
| John Doe | IT | `john.doe` |
| Jane Smith | HR | `janes` |
| Bob Wilson | Sales | `bwilson` |

---

### Example 5: Preferred Name Support

**Scenario:** Use preferred name if available, otherwise use first name.

**Expression:**
```velocity
#if($preferredName && $preferredName.length() > 0)
${preferredName}.${lastName}
#else
${firstName}.${lastName}
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`

**Sample Output:**
| First | Preferred | Last | Output |
|-------|-----------|------|--------|
| Robert | Bob | Smith | `bob.smith` |
| Jennifer | | Doe | `jennifer.doe` |

---

## Employee ID Generation

### Example 6: Sequential Employee Numbers

**Scenario:** Generate sequential employee IDs starting from 10000.

**Expression:**
```velocity
EMP$counter
```

**Configuration:**
- Attribute Type: `Counter-based`
- Counter Start Value: `10000`
- Minimum Counter Digits: `5`

**Sample Output:**
- `EMP10000`, `EMP10001`, `EMP10002`...

---

### Example 7: Department Code + Counter

**Scenario:** Include department code in employee ID.

**Expression:**
```velocity
#if($department == 'IT')
IT$counter
#elseif($department == 'HR')
HR$counter
#elseif($department == 'Sales')
SL$counter
#else
GN$counter
#end
```

**Configuration:**
- Attribute Type: `Counter-based`
- Counter Start Value: `1000`
- Minimum Counter Digits: `4`

**Sample Output:**
| Department | Output |
|------------|--------|
| IT | `IT1000` |
| HR | `HR1001` |
| Sales | `SL1002` |

---

### Example 8: Location-Based Employee ID

**Scenario:** Generate employee IDs with location prefix and date.

**Expression:**
```velocity
#set($parsed = $Address.parse($workLocation))
#set($stateCode = $parsed.state)
#if($stateCode)
${stateCode}$counter
#else
XX$counter
#end
```

**Configuration:**
- Attribute Type: `Counter-based`
- Counter Start Value: `1`
- Minimum Counter Digits: `6`

**Sample Output:**
- `WA000001`, `TX000002`, `NY000003`

---

## Display Name Formatting

### Example 9: Formal Display Name

**Scenario:** Create formal display name with proper capitalization.

**Expression:**
```velocity
$Normalize.name("$firstName $lastName")
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

**Sample Input/Output:**
| Input | Output |
|-------|--------|
| john doe | John Doe |
| JANE SMITH | Jane Smith |
| mary o'brien | Mary O'Brien |

---

### Example 10: Display Name with Title

**Scenario:** Include job title in display name.

**Expression:**
```velocity
#if($title && $title.length() > 0)
$Normalize.name("$firstName $lastName") - $title
#else
$Normalize.name("$firstName $lastName")
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

**Sample Output:**
- `John Doe - Senior Engineer`
- `Jane Smith - VP of Sales`

---

### Example 11: Display Name with Location

**Scenario:** Show employee location in display name.

**Expression:**
```velocity
#set($parsed = $Address.parse($workLocation))
#if($parsed && $parsed.city && $parsed.state)
$Normalize.name("$firstName $lastName") (${parsed.city}, ${parsed.state})
#else
$Normalize.name("$firstName $lastName")
#end
```

**Sample Output:**
- `John Doe (Seattle, WA)`
- `Jane Smith (Austin, TX)`

---

## Multi-Source Data Integration

### Example 12: Prefer HR Data, Fallback to AD

**Scenario:** Use HR system data when available, otherwise use Active Directory.

**Expression:**
```velocity
#set($hrAccounts = $sources.get('HR System'))
#set($adAccounts = $sources.get('Active Directory'))

#if($hrAccounts && $hrAccounts.size() > 0)
$hrAccounts.get(0).employeeId
#elseif($adAccounts && $adAccounts.size() > 0)
$adAccounts.get(0).employeeNumber
#else
UNKNOWN
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

---

### Example 13: Combine Multiple Source Attributes

**Scenario:** Merge department information from multiple sources.

**Expression:**
```velocity
#set($hrAccounts = $sources.get('HR System'))
#set($adAccounts = $sources.get('Active Directory'))

#if($hrAccounts && $hrAccounts.size() > 0 && $hrAccounts.get(0).department)
$hrAccounts.get(0).department
#elseif($adAccounts && $adAccounts.size() > 0 && $adAccounts.get(0).department)
$adAccounts.get(0).department
#elseif($identity.department)
$identity.department
#else
Not Assigned
#end
```

---

### Example 14: Use Identity Attribute with Fallback

**Scenario:** Reference identity's UID, with fallback to generated value.

**Expression:**
```velocity
#if($identity.uid && $identity.uid.length() > 0)
$identity.uid
#else
${firstName.substring(0,1)}${lastName}$counter
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`

---

## Date and Time Operations

### Example 15: Format Hire Date

**Scenario:** Standardize hire date format.

**Expression:**
```velocity
#set($date = $Normalize.date($hireDate))
#if($date)
$Datefns.format($date, 'yyyy-MM-dd')
#else
Unknown
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `No`

**Sample Output:**
- `2023-05-15`, `2024-01-10`

---

### Example 16: Calculate Tenure

**Scenario:** Calculate years of service.

**Expression:**
```velocity
#set($hire = $Normalize.date($hireDate))
#if($hire)
#set($years = $Datefns.differenceInYears($Date.now(), $hire))
$years years
#else
Unknown
#end
```

**Sample Output:**
- `3 years`, `5 years`

---

### Example 17: Account Expiration Date

**Scenario:** Set account to expire 1 year from creation.

**Expression:**
```velocity
$Datefns.format($Datefns.addYears($Date.now(), 1), 'yyyy-MM-dd')
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `No` (set once)

**Sample Output:**
- `2027-01-21`

---

### Example 18: Contract End Date Calculation

**Scenario:** Calculate contract end date from start date and duration.

**Expression:**
```velocity
#set($start = $Normalize.date($contractStartDate))
#set($months = $contractDurationMonths)
#if($start && $months)
$Datefns.format($Datefns.addMonths($start, $months), 'yyyy-MM-dd')
#else
Unknown
#end
```

---

### Example 19: Age Verification

**Scenario:** Calculate if person is over 18.

**Expression:**
```velocity
#set($birth = $Normalize.date($birthDate))
#if($birth)
#set($age = $Datefns.differenceInYears($Date.now(), $birth))
#if($age >= 18)
Verified
#else
Under Age
#end
#else
Unknown
#end
```

---

## Contact Information Normalization

### Example 20: Phone Number Standardization

**Scenario:** Format phone numbers to international format.

**Expression:**
```velocity
#set($phone = $Normalize.phone($phoneNumber))
#if($phone)
$phone
#elseif($phoneNumber)
$phoneNumber
#else
Not Provided
#end
```

**Sample Input/Output:**
| Input | Output |
|-------|--------|
| 5551234567 | +1 555 123 4567 |
| (555) 123-4567 | +1 555 123 4567 |
| +1-555-123-4567 | +1 555 123 4567 |

---

### Example 21: Email Validation and Normalization

**Scenario:** Ensure email is lowercase and valid format.

**Expression:**
```velocity
#if($email && $email.contains('@'))
${email.toLowerCase()}
#else
noemail@company.com
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Case Selection: `Lower case`

---

### Example 22: Business Email Generation

**Scenario:** Generate corporate email from name.

**Expression:**
```velocity
${firstName.toLowerCase()}.${lastName.toLowerCase()}@company.com
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`

**Sample Output:**
- `john.doe@company.com`
- `jane.smith@company.com`

---

## Location-Based Attributes

### Example 23: Extract Office Location

**Scenario:** Parse city and state from full address.

**Expression:**
```velocity
#set($parsed = $Address.parse($officeAddress))
#if($parsed && $parsed.city && $parsed.state)
${parsed.city}, ${parsed.state}
#else
Remote
#end
```

**Sample Output:**
- `Seattle, WA`
- `Austin, TX`
- `Remote`

---

### Example 24: Validate City/State Combination

**Scenario:** Verify city belongs to specified state.

**Expression:**
```velocity
#set($expectedState = $Address.getCityState($city))
#if($expectedState && $expectedState == $state)
Valid
#else
Invalid
#end
```

---

### Example 25: Location Code Generation

**Scenario:** Generate location code from city.

**Expression:**
```velocity
#set($stateCode = $Address.getCityState($city))
#if($stateCode)
LOC-${stateCode}-$counter
#else
LOC-XX-$counter
#end
```

**Configuration:**
- Attribute Type: `Counter-based`
- Counter Start Value: `1000`
- Minimum Counter Digits: `4`

**Sample Output:**
- `LOC-WA-1000`, `LOC-TX-1001`

---

## Conditional Logic Scenarios

### Example 26: Employee Type Classification

**Scenario:** Classify employees based on attributes.

**Expression:**
```velocity
#if($employeeType == 'FTE')
Full-Time Employee
#elseif($employeeType == 'Contractor')
Contractor
#elseif($employeeType == 'Intern')
Intern
#else
Other
#end
```

---

### Example 27: Access Level Determination

**Scenario:** Determine access level based on department and title.

**Expression:**
```velocity
#if($title.contains('VP') || $title.contains('Director'))
Executive
#elseif($department == 'IT' && $title.contains('Admin'))
IT Admin
#elseif($department == 'Security')
Security Team
#else
Standard
#end
```

---

### Example 28: Manager Flag

**Scenario:** Set flag if employee is a manager.

**Expression:**
```velocity
#if($directReports && $directReports > 0)
Manager
#elseif($title.contains('Manager') || $title.contains('Director') || $title.contains('VP'))
Manager
#else
Individual Contributor
#end
```

---

## Data Validation and Cleanup

### Example 29: SSN Formatting

**Scenario:** Normalize SSN to digits only.

**Expression:**
```velocity
#set($ssn = $Normalize.ssn($socialSecurityNumber))
#if($ssn)
$ssn
#else
Invalid SSN
#end
```

**Sample Input/Output:**
| Input | Output |
|-------|--------|
| 123-45-6789 | 123456789 |
| 123 45 6789 | 123456789 |
| 12345 | Invalid SSN |

---

### Example 30: Remove Special Characters from ID

**Scenario:** Clean external ID of special characters.

**Expression:**
```velocity
#if($externalId)
${externalId.replaceAll('[^a-zA-Z0-9]', '')}
#else
NOID
#end
```

**Sample Input/Output:**
| Input | Output |
|-------|--------|
| EMP-12345 | EMP12345 |
| A/B/C-999 | ABC999 |

---

### Example 31: Truncate Long Values

**Scenario:** Ensure description doesn't exceed character limit.

**Expression:**
```velocity
#if($description && $description.length() > 100)
${description.substring(0, 97)}...
#elseif($description)
$description
#else
No description
#end
```

---

## Advanced Patterns

### Example 32: Composite Key Generation

**Scenario:** Generate complex unique key from multiple attributes.

**Expression:**
```velocity
#set($date = $Normalize.date($hireDate))
#set($dateStr = $Datefns.format($date, 'yyyyMMdd'))
#set($loc = $Address.getCityState($city))
#if($loc && $dateStr)
${loc}-${dateStr}-${firstName.substring(0,1)}${lastName.substring(0,1)}$counter
#else
DEFAULT-$counter
#end
```

**Sample Output:**
- `WA-20230515-JD00001`
- `TX-20240310-JS00002`

---

### Example 33: Previous Value Comparison

**Scenario:** Detect if email has changed.

**Expression:**
```velocity
#if($email != $previous.email)
Email changed from $previous.email to $email
#else
No change
#end
```

---

### Example 34: Multi-Account Aggregation

**Scenario:** Collect all email addresses from multiple accounts.

**Expression:**
```velocity
#set($emails = [])
#foreach($account in $accounts)
  #if($account.email)
    #set($added = $emails.add($account.email))
  #end
#end
#if($emails.size() > 0)
  $emails.toString()
#else
  No emails
#end
```

---

### Example 35: Complex Status Determination

**Scenario:** Determine account status based on multiple factors.

**Expression:**
```velocity
#set($hire = $Normalize.date($hireDate))
#set($term = $Normalize.date($terminationDate))
#set($today = $Date.now())

#if($term && $Datefns.isBefore($term, $today))
Terminated
#elseif($hire && $Datefns.isAfter($hire, $today))
Future Start
#elseif($disabled)
Disabled
#else
Active
#end
```

---

### Example 36: Dynamic Username with Multiple Fallbacks

**Scenario:** Comprehensive username generation with multiple fallback strategies.

**Expression:**
```velocity
## Strategy 1: Use AD account if available
#set($adAccounts = $sources.get('Active Directory'))
#if($adAccounts && $adAccounts.size() > 0 && $adAccounts.get(0).samAccountName)
$adAccounts.get(0).samAccountName

## Strategy 2: Use HR employee ID
#elseif($sources.get('HR System') && $sources.get('HR System').size() > 0)
#set($empId = $sources.get('HR System').get(0).employeeId)
#if($empId)
emp${empId}
#end

## Strategy 3: Email prefix
#elseif($email && $email.contains('@'))
#set($parts = $email.split('@'))
$parts[0]

## Strategy 4: Generate from name
#elseif($firstName && $lastName)
${firstName}.${lastName}

## Strategy 5: Use identity UID
#elseif($identity.uid)
$identity.uid

## Fallback: Generate random
#else
user$Math.floor($Math.random() * 1000000)
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`

---

## Testing Your Expressions

### Test Checklist

When creating Velocity expressions, test with these scenarios:

1. **Null Values**
   ```velocity
   firstName = null
   lastName = null
   email = null
   ```

2. **Empty Strings**
   ```velocity
   firstName = ""
   lastName = ""
   ```

3. **Special Characters**
   ```velocity
   firstName = "José"
   lastName = "O'Brien-Smith"
   ```

4. **Very Long Values**
   ```velocity
   firstName = "Verylongfirstname"
   lastName = "Verylonglastname"
   ```

5. **Missing Sources**
   ```velocity
   sources.get('NonExistentSource') = null
   ```

6. **Invalid Dates**
   ```velocity
   hireDate = "invalid"
   hireDate = ""
   ```

---

## Performance Tips

1. **Cache Parsed Values**
   ```velocity
   ## Good - parse once
   #set($date = $Normalize.date($hireDate))
   Start: $Datefns.format($date, 'yyyy-MM-dd')
   End: $Datefns.addYears($date, 1)
   
   ## Bad - parse multiple times
   Start: $Datefns.format($Normalize.date($hireDate), 'yyyy-MM-dd')
   End: $Datefns.addYears($Normalize.date($hireDate), 1)
   ```

2. **Check Existence Before Operations**
   ```velocity
   ## Good
   #if($text && $text.length() > 0)
     ${text.toLowerCase()}
   #end
   
   ## Bad (may cause errors)
   ${text.toLowerCase()}
   ```

3. **Limit Loop Iterations**
   ```velocity
   ## Good - limit iterations
   #foreach($account in $accounts)
     #if($velocityCount <= 10)
       Process $account
     #end
   #end
   ```

---

For more information, see:
- [Velocity Expressions Guide](VELOCITY_EXPRESSIONS_GUIDE.md)
- [Velocity Quick Reference](VELOCITY_QUICK_REFERENCE.md)
