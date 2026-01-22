# Velocity Expressions Guide for Identity Fusion NG Connector

## Table of Contents

1. [Introduction](#introduction)
2. [Velocity Basics](#velocity-basics)
3. [Available Context Data](#available-context-data)
4. [Built-in Helpers](#built-in-helpers)
5. [Normalizers](#normalizers)
6. [Address Parse Helpers](#address-parse-helpers)
7. [Attribute Definition Examples](#attribute-definition-examples)
8. [Best Practices](#best-practices)
9. [Common Patterns](#common-patterns)
10. [Troubleshooting](#troubleshooting)

---

## Introduction

The Identity Fusion NG connector uses **Apache Velocity** templates to generate dynamic attribute values. Velocity expressions provide a flexible way to:

- Generate unique identifiers from account attributes
- Transform and format attribute values
- Access data from multiple sources
- Reference identity attributes and previous values
- Use powerful helper functions and normalizers

This guide covers all the extended functionality available in Velocity expressions within the connector.

---

## Velocity Basics

### Basic Syntax

Velocity uses `$` to reference variables:

```velocity
$firstName
${firstName}
```

### String Concatenation

```velocity
$firstName $lastName
${firstName}.${lastName}
```

### Conditional Logic

```velocity
#if($department)
  $department
#else
  Unknown
#end
```

### Null-Safe Access

```velocity
$!{attribute}  ## Returns empty string if attribute is null
```

### Comments

```velocity
## This is a comment
#* 
   This is a 
   multi-line comment 
*#
```

---

## Available Context Data

The Velocity context provides access to multiple layers of data when generating attributes:

### 1. Current Attributes

All mapped attributes from source accounts are directly available:

```velocity
$firstName
$lastName
$email
$department
$title
```

### 2. Previous Attributes

Access the previous values of attributes (from the last aggregation):

```velocity
## Check if department changed
#if($department != $previous.department)
  Department changed from $previous.department to $department
#end

## Use previous value if current is empty
#if(!$email)
  $previous.email
#else
  $email
#end
```

### 3. Identity Attributes

Access attributes from the correlated identity (when available):

```velocity
## Use identity's display name
$identity.displayName

## Reference identity's UID
$identity.uid

## Access custom identity attributes
$identity.customAttribute1
```

**Common Identity Attributes:**
- `displayName` - Identity's display name
- `email` - Identity's primary email
- `uid` - Identity's unique identifier
- `name` - Identity's name
- `firstName`, `lastName` - Name components
- Custom attributes configured in your identity profile

### 4. Contributing Managed Accounts

Access individual account attributes from specific sources:

```velocity
## Access accounts as an array
#foreach($account in $accounts)
  $account.email
#end

## Access source-specific accounts
#foreach($hrAccount in $sources.get('HR System'))
  $hrAccount.employeeId
#end

## Get first account from a specific source
#set($adAccounts = $sources.get('Active Directory'))
#if($adAccounts && $adAccounts.size() > 0)
  $adAccounts.get(0).samAccountName
#end
```

### 5. Special Variables

- `$counter` - Available for unique and counter-based attributes (auto-incremented)

---

## Built-in Helpers

The connector provides several helper objects to extend Velocity's functionality:

### Math Object

Use JavaScript's Math object for mathematical operations:

```velocity
## Rounding
$Math.round($value)
$Math.floor($value)
$Math.ceil($value)

## Min/Max
$Math.max($a, $b)
$Math.min($a, $b)

## Absolute value
$Math.abs($value)

## Power and square root
$Math.pow($base, $exponent)
$Math.sqrt($value)

## Random numbers
$Math.random()  ## Returns 0-1
```

**Example Use Cases:**

```velocity
## Calculate age from birth year
#set($currentYear = 2026)
#set($age = $Math.floor($currentYear - $birthYear))
$age

## Generate random employee number
$Math.floor($Math.random() * 1000000)
```

### Date Object

Access JavaScript's Date object for date operations:

```velocity
## Current timestamp
$Date.now()

## Create date from string
#set($date = $Date.parse('2026-01-15'))
```

### Datefns Library

The connector includes the popular [date-fns](https://date-fns.org/) library for advanced date formatting and manipulation:

#### Date Formatting

```velocity
## Format dates
$Datefns.format($date, 'yyyy-MM-dd')
$Datefns.format($date, 'MM/dd/yyyy')
$Datefns.format($date, "MMMM do, yyyy")

## ISO formats
$Datefns.formatISO($date)
$Datefns.formatISO9075($date)
```

#### Date Arithmetic

```velocity
## Add/subtract time
$Datefns.addDays($date, 7)
$Datefns.addMonths($date, 3)
$Datefns.addYears($date, 1)
$Datefns.subDays($date, 5)

## Start/end of periods
$Datefns.startOfDay($date)
$Datefns.endOfMonth($date)
$Datefns.startOfYear($date)
```

#### Date Comparison

```velocity
## Compare dates
$Datefns.isBefore($date1, $date2)
$Datefns.isAfter($date1, $date2)
$Datefns.isEqual($date1, $date2)
$Datefns.isFuture($date)
$Datefns.isPast($date)

## Difference between dates
$Datefns.differenceInDays($date1, $date2)
$Datefns.differenceInMonths($date1, $date2)
$Datefns.differenceInYears($date1, $date2)
```

**Example Use Cases:**

```velocity
## Format hire date
$Datefns.format($Normalize.date($hireDate), 'yyyy-MM-dd')

## Calculate tenure
$Datefns.differenceInYears($Date.now(), $Normalize.date($hireDate)) years

## Create expiration date
$Datefns.format($Datefns.addYears($Date.now(), 1), 'yyyy-MM-dd')
```

---

## Normalizers

The `Normalize` object provides specialized normalizers for common data types:

### Normalize.date()

Parse dates from various formats:

```velocity
## Parse flexible date formats
$Normalize.date('2026-01-15')
$Normalize.date('01/15/2026')
$Normalize.date('January 15, 2026')
$Normalize.date('15 Jan 2026')

## Returns ISO 8601 string
```

**Example:**

```velocity
## Normalize date format
$Datefns.format($Normalize.date($birthDate), 'yyyy-MM-dd')
```

### Normalize.phone()

Format phone numbers to international format:

```velocity
## Parse and format phone numbers
$Normalize.phone('5551234567')       ## Returns: +1 555 123 4567
$Normalize.phone('(555) 123-4567')   ## Returns: +1 555 123 4567
$Normalize.phone('+1-555-123-4567')  ## Returns: +1 555 123 4567
```

**Example:**

```velocity
## Standardize phone number
#set($phone = $Normalize.phone($phoneNumber))
#if($phone)
  $phone
#else
  $phoneNumber
#end
```

### Normalize.name()

Parse and normalize person names:

```velocity
## Parse name and capitalize properly
$Normalize.name('john doe')          ## Returns: John Doe
$Normalize.name('JANE SMITH')        ## Returns: Jane Smith
$Normalize.name('o\'brien, patrick') ## Returns: Patrick O'Brien
```

The name normalizer:
- Handles first name and last name extraction
- Properly capitalizes names
- Handles common name prefixes and suffixes
- Respects cultural naming conventions

**Example:**

```velocity
## Normalize full name
$Normalize.name($fullName)

## Use in unique ID generation
$Normalize.name("$firstName $lastName")
```

### Normalize.ssn()

Normalize Social Security Numbers:

```velocity
## Parse and normalize SSN
$Normalize.ssn('123-45-6789')   ## Returns: 123456789
$Normalize.ssn('123 45 6789')   ## Returns: 123456789
$Normalize.ssn('123456789')     ## Returns: 123456789

## Invalid length returns undefined
$Normalize.ssn('12345')         ## Returns: undefined
```

**Example:**

```velocity
## Standardize SSN
#set($ssn = $Normalize.ssn($socialSecurityNumber))
#if($ssn)
  Last 4: ${ssn.substring(5)}
#end
```

### Normalize.address()

Normalize and format full address strings:

```velocity
## Parse and normalize addresses (returns full formatted address)
$Normalize.address('123 Main St, Seattle, WA 98101')
## Returns: 123 Main St, Seattle, WA 98101

$Normalize.address('456 Oak Ave, Apt 2B, Austin, TX 78701')
## Returns: 456 Oak Ave, Apt 2B, Austin, TX 78701
```

The address normalizer:
- Parses and standardizes complete addresses
- Extracts and formats street, city, state, and postal code
- Validates state codes
- Handles various address formats
- Returns normalized, comma-separated format

**Example:**

```velocity
## Normalize full address
#set($standardAddr = $Normalize.address($fullAddress))
$standardAddr
```

---

## Address Helpers

The `Address` object provides specialized address parsing and validation:

### Address.getCityState()

Get state code from city name (US only):

```velocity
## Look up state from city
$Address.getCityState('Seattle')    ## Returns: WA
$Address.getCityState('Austin')     ## Returns: TX
$Address.getCityState('Portland')   ## Returns: OR (first match)
```

**Example:**

```velocity
## Validate city/state combination
#set($stateCode = $Address.getCityState($city))
#if($stateCode == $state)
  Valid location
#end
```

### Address.parse()

Parse full address into components:

```velocity
#set($addr = $Address.parse('123 Main St, Seattle, WA 98101'))
$addr.street_address1  ## 123 Main St
$addr.city             ## Seattle
$addr.state            ## WA
$addr.postal_code      ## 98101
```

**Available Components:**
- `street_address1` - Primary street address
- `street_address2` - Secondary address (apt, suite, etc.)
- `city` - City name
- `state` - State code
- `postal_code` - ZIP/postal code

**Example:**

```velocity
## Extract city from full address
#set($parsed = $Address.parse($fullAddress))
#if($parsed && $parsed.city)
  $parsed.city
#end
```

### Address.format()

Format parsed address into standardized string:

```velocity
## Format address consistently
$Address.format('123 Main St, Apt 4B, Seattle, WA 98101')
## Returns: 123 Main St, Apt 4B, Seattle, WA 98101
```

---

## Attribute Definition Examples

### Example 1: Basic Unique Username

Generate a unique username from first and last name:

```velocity
${firstName}.${lastName}
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Normalize Special Characters: `Yes`
- Remove Spaces: `No`

**Result:** `john.doe`, `john.doe1`, `john.doe2` (if duplicates exist)

### Example 2: Email-Based Username

Use email prefix as username:

```velocity
#set($parts = $email.split('@'))
$parts[0]
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`

**Result:** `john.smith` from `john.smith@example.com`

### Example 3: Employee ID with Counter

Generate sequential employee IDs:

```velocity
EMP$counter
```

**Configuration:**
- Attribute Type: `Counter-based`
- Counter Start Value: `1000`
- Minimum Counter Digits: `5`

**Result:** `EMP01000`, `EMP01001`, `EMP01002`...

### Example 4: Formatted Display Name

Create properly formatted display name:

```velocity
$Normalize.name("$firstName $lastName")
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

**Result:** `John O'Brien` (properly capitalized)

### Example 5: Normalized Phone Number

Standardize phone number format:

```velocity
#set($phone = $Normalize.phone($phoneNumber))
#if($phone)
$phone
#else
$phoneNumber
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

### Example 6: Tenure Calculation

Calculate years of service:

```velocity
#set($hire = $Normalize.date($hireDate))
#if($hire)
$Datefns.differenceInYears($Date.now(), $hire)
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

### Example 7: Account Expiration Date

Set account expiration to 1 year from now:

```velocity
$Datefns.format($Datefns.addYears($Date.now(), 1), 'yyyy-MM-dd')
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `No`

### Example 8: Conditional Username

Use different username format based on department:

```velocity
#if($department == 'IT')
${firstName}.${lastName}
#elseif($department == 'HR')
${firstName}${lastName.substring(0,1)}
#else
${firstName.substring(0,1)}${lastName}
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`

### Example 9: Multi-Source Username

Prefer AD username, fallback to email:

```velocity
#set($adAccounts = $sources.get('Active Directory'))
#if($adAccounts && $adAccounts.size() > 0)
$adAccounts.get(0).samAccountName
#else
#set($parts = $email.split('@'))
$parts[0]
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`

### Example 10: Location-Based Prefix

Add location prefix to username:

```velocity
#set($parsed = $Address.parse($address))
#if($parsed && $parsed.state)
${parsed.state}-${firstName}.${lastName}
#else
${firstName}.${lastName}
#end
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`

**Result:** `WA-john.doe`, `TX-jane.smith`

### Example 11: Previous Value Fallback

Use previous value if current is empty:

```velocity
#if($!{email})
$email
#elseif($previous.email)
$previous.email
#else
unknown@company.com
#end
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `Yes`

### Example 12: Identity Attribute Reference

Use identity's UID for fusion account:

```velocity
$identity.uid
```

**Configuration:**
- Attribute Type: `Normal`
- Refresh on Each Aggregation: `No`

### Example 13: Truncated Name with Max Length

Generate username with maximum length constraint:

```velocity
${firstName}.${lastName}
```

**Configuration:**
- Attribute Type: `Unique`
- Case Selection: `Lower case`
- Maximum Length: `20`

**Note:** If the result exceeds 20 characters and has a counter, the counter is preserved at the end (e.g., `verylongfirstna.la17`)

### Example 14: Complex Formatted Display

Create formatted user display with multiple attributes:

```velocity
$Normalize.name("$firstName $lastName") ($department - $title)
```

**Configuration:**
- Attribute Type: `Normal`

**Result:** `John O'Brien (IT - Senior Engineer)`

### Example 15: Normalized SSN Last 4

Extract and format SSN last 4 digits:

```velocity
#set($ssn = $Normalize.ssn($socialSecurityNumber))
#if($ssn)
${ssn.substring(5)}
#end
```

**Configuration:**
- Attribute Type: `Normal`

**Result:** `6789`

---

## Best Practices

### 1. Null Safety

Always check for null values before using attributes:

```velocity
## Bad
$firstName.toLowerCase()

## Good
#if($firstName)
  $firstName.toLowerCase()
#end

## Better (null-safe operator)
$!{firstName.toLowerCase()}
```

### 2. Default Values

Provide sensible defaults:

```velocity
#if($email)
  $email
#else
  unknown@company.com
#end
```

### 3. Test Expressions

Test your expressions with sample data before deploying:

1. Start with simple expressions
2. Add complexity incrementally
3. Test edge cases (null, empty, special characters)
4. Verify with actual account data

### 4. Use Variables for Clarity

Break complex expressions into steps:

```velocity
## Good - readable and debuggable
#set($hire = $Normalize.date($hireDate))
#set($today = $Date.now())
#set($tenure = $Datefns.differenceInYears($today, $hire))
Tenure: $tenure years

## Versus one-liner
Tenure: $Datefns.differenceInYears($Date.now(), $Normalize.date($hireDate)) years
```

### 5. Handle Missing Data Sources

When accessing source-specific accounts, check for existence:

```velocity
#set($hrAccounts = $sources.get('HR System'))
#if($hrAccounts && $hrAccounts.size() > 0)
  #set($hr = $hrAccounts.get(0))
  $hr.employeeId
#else
  No HR account found
#end
```

### 6. Document Complex Logic

Use comments to explain business logic:

```velocity
## Use employee ID from HR system for internal staff
## Otherwise use email prefix for contractors
#set($hrAccounts = $sources.get('HR System'))
#if($hrAccounts && $hrAccounts.size() > 0)
  $hrAccounts.get(0).employeeId
#else
  #set($parts = $email.split('@'))
  $parts[0]
#end
```

### 7. Optimize for Performance

Avoid expensive operations in loops:

```velocity
## Bad - Normalize.date called multiple times
#foreach($account in $accounts)
  $Datefns.format($Normalize.date($account.hireDate), 'yyyy-MM-dd')
#end

## Better - if using same date
#set($formattedDate = $Datefns.format($Normalize.date($hireDate), 'yyyy-MM-dd'))
$formattedDate
```

### 8. Consider Attribute Types

Choose the right attribute type for your use case:

- **Normal**: Standard attributes that can change
- **Unique**: Usernames, IDs that must be unique
- **UUID**: Immutable identifiers
- **Counter-based**: Sequential numbers

### 9. Use Counter Wisely

For unique attributes, the counter is automatically appended:

```velocity
## Your expression
${firstName}.${lastName}

## System may generate
john.doe
john.doe1
john.doe2
```

You can also explicitly include `$counter`:

```velocity
## Explicit counter placement
${firstName}.${lastName}$counter

## Or with separator
${firstName}.${lastName}-$counter
```

---

## Common Patterns

### Pattern 1: Cascade Fallback

Try multiple sources in order:

```velocity
#set($adAccounts = $sources.get('Active Directory'))
#set($hrAccounts = $sources.get('HR System'))

#if($adAccounts && $adAccounts.size() > 0)
  $adAccounts.get(0).samAccountName
#elseif($hrAccounts && $hrAccounts.size() > 0)
  $hrAccounts.get(0).employeeId
#elseif($email)
  #set($parts = $email.split('@'))
  $parts[0]
#else
  unknown
#end
```

### Pattern 2: Combine Multiple Attributes

Create composite values:

```velocity
## Location-Department code
#set($parsed = $Address.parse($address))
#if($parsed && $parsed.state)
  ${parsed.state}-${department}
#end
```

### Pattern 3: Conditional Formatting

Apply different formats based on conditions:

```velocity
## Format name differently for executives
#if($title.contains('VP') || $title.contains('CEO'))
  $lastName, ${firstName.substring(0,1)}.
#else
  $Normalize.name("$firstName $lastName")
#end
```

### Pattern 4: Date Range Validation

Verify dates fall within expected range:

```velocity
#set($hire = $Normalize.date($hireDate))
#set($today = $Date.now())
#if($Datefns.isBefore($hire, $today) && $Datefns.isAfter($hire, $Datefns.subYears($today, 50)))
  Valid hire date
#else
  Invalid hire date
#end
```

### Pattern 5: Extract from Complex Strings

Parse and extract specific parts:

```velocity
## Extract domain from email
#set($parts = $email.split('@'))
#if($parts.size() > 1)
  $parts[1]
#end

## Extract area code from phone
#set($phone = $Normalize.phone($phoneNumber))
#if($phone)
  ${phone.substring(3, 6)}
#end
```

---

## Troubleshooting

### Common Issues

#### Issue 1: Expression Returns Empty

**Problem:** Velocity expression returns an empty string

**Possible Causes:**
- Attribute is null or undefined
- Conditional logic skips all branches
- Normalizer returns undefined

**Solution:**
```velocity
## Debug by checking each step
First Name: $!{firstName}
Last Name: $!{lastName}
Email: $!{email}

## Add default values
#if($firstName && $lastName)
  ${firstName}.${lastName}
#else
  default.user
#end
```

#### Issue 2: Counter Not Working

**Problem:** Unique attribute doesn't have counter suffix

**Possible Causes:**
- Attribute type not set to "Unique"
- Expression doesn't include `$counter` variable
- Maximum length is too restrictive

**Solution:**
- Set Attribute Type to "Unique" or "Counter-based"
- Ensure expression ends with `$counter` (auto-added for unique types)
- Increase Maximum Length to accommodate counter

#### Issue 3: Special Characters Not Normalized

**Problem:** Special characters appear in generated value

**Solution:**
- Enable "Normalize Special Characters" in attribute configuration
- Or manually handle in expression:

```velocity
## Manual normalization is handled by the system
## Just enable the normalize option
```

#### Issue 4: Normalizer Returns Null

**Problem:** `Normalize.date()` or other normalizers return null

**Possible Causes:**
- Invalid input format
- Null or empty input

**Solution:**
```velocity
## Always check normalizer results
#set($date = $Normalize.date($dateString))
#if($date)
  $Datefns.format($date, 'yyyy-MM-dd')
#else
  Invalid date: $!{dateString}
#end
```

#### Issue 5: Source Not Found

**Problem:** `$sources.get('Source Name')` returns null

**Possible Causes:**
- Source name doesn't match exactly (case-sensitive)
- Source not configured in connector
- No accounts from that source correlated

**Solution:**
```velocity
## Debug sources
Available sources:
#foreach($source in $sources.keySet())
  - $source
#end

## Case-sensitive check
#set($accounts = $sources.get('Active Directory'))  ## Exact name
```

#### Issue 6: Attribute Changed Unexpectedly

**Problem:** Attribute value changes on every aggregation

**Possible Causes:**
- "Refresh on Each Aggregation" is enabled
- Expression uses dynamic values (dates, random numbers)

**Solution:**
- Disable "Refresh on Each Aggregation" for stable values
- Use previous value when available:

```velocity
## Only generate if not exists
#if($previous.username)
  $previous.username
#else
  ${firstName}.${lastName}
#end
```

### Debugging Tips

1. **Enable Debug Logging**
   - Check connector logs for Velocity evaluation results
   - Logs show: expression, context, and result

2. **Test Incrementally**
   - Start with simple expression: `$firstName`
   - Add complexity step by step
   - Test after each change

3. **Use Temporary Display Attributes**
   - Create test attributes to view intermediate values
   - Example: Create "debug" attribute with `$sources.keySet()`

4. **Validate Input Data**
   - Check source account data in ISC
   - Verify attributes exist and have expected values
   - Check attribute mapping configuration

5. **Review Transformation Order**
   The connector applies transformations in this order:
   1. Velocity template evaluation
   2. Case transformation
   3. Space removal (if enabled)
   4. Trim spaces (if enabled)
   5. Normalize special characters (if enabled)
   6. Truncate to max length (if set)
   7. Add counter (for unique attributes)

---

## Additional Resources

- [Velocity Quick Reference](VELOCITY_QUICK_REFERENCE.md) - Quick lookup reference card
- [Velocity Practical Examples](VELOCITY_EXAMPLES.md) - Real-world examples and scenarios
- [Apache Velocity User Guide](https://velocity.apache.org/engine/2.3/user-guide.html)
- [date-fns Documentation](https://date-fns.org/docs/Getting-Started)
- [Identity Fusion NG Connector README](../README.md)

---

## Support

For questions or issues with Velocity expressions in the Identity Fusion NG connector:

1. Check this guide for examples and patterns
2. Review connector logs for debugging information
3. Post questions in [SailPoint Developer Community](https://developer.sailpoint.com/discuss)
4. Open an issue on the connector's GitHub repository

---

*Last Updated: January 2026*
