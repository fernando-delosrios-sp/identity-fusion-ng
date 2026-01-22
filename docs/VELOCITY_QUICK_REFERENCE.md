# Velocity Expressions Quick Reference

Quick reference for Velocity expressions in Identity Fusion NG connector.

## Basic Syntax

| Syntax | Description | Example |
|--------|-------------|---------|
| `$variable` | Reference variable | `$firstName` |
| `${variable}` | Reference with braces | `${firstName}` |
| `$!{variable}` | Null-safe reference | `$!{email}` |
| `#set($var = value)` | Set variable | `#set($name = "John")` |
| `##` | Comment | `## This is a comment` |

## Context Data

| Variable | Description | Example |
|----------|-------------|---------|
| `$firstName` | Current attribute | `$firstName` |
| `$previous.email` | Previous value | `$previous.email` |
| `$identity.uid` | Identity attribute | `$identity.uid` |
| `$accounts` | All accounts array | `#foreach($a in $accounts)` |
| `$sources` | Source-specific accounts | `$sources.get('AD')` |
| `$counter` | Auto-increment counter | `EMP$counter` |

## Math Helpers

| Function | Description | Example |
|----------|-------------|---------|
| `$Math.round($x)` | Round number | `$Math.round(3.7)` → `4` |
| `$Math.floor($x)` | Round down | `$Math.floor(3.7)` → `3` |
| `$Math.ceil($x)` | Round up | `$Math.ceil(3.2)` → `4` |
| `$Math.max($a, $b)` | Maximum value | `$Math.max(5, 10)` → `10` |
| `$Math.min($a, $b)` | Minimum value | `$Math.min(5, 10)` → `5` |
| `$Math.abs($x)` | Absolute value | `$Math.abs(-5)` → `5` |
| `$Math.random()` | Random 0-1 | `$Math.random()` → `0.437...` |

## Date Helpers (Datefns)

| Function | Description | Example |
|----------|-------------|---------|
| `$Date.now()` | Current timestamp | `$Date.now()` |
| `$Datefns.format($date, fmt)` | Format date | `$Datefns.format($date, 'yyyy-MM-dd')` |
| `$Datefns.addDays($date, n)` | Add days | `$Datefns.addDays($date, 7)` |
| `$Datefns.addMonths($date, n)` | Add months | `$Datefns.addMonths($date, 3)` |
| `$Datefns.addYears($date, n)` | Add years | `$Datefns.addYears($date, 1)` |
| `$Datefns.subDays($date, n)` | Subtract days | `$Datefns.subDays($date, 5)` |
| `$Datefns.differenceInYears($d1, $d2)` | Years between | `$Datefns.differenceInYears($now, $hire)` |
| `$Datefns.differenceInDays($d1, $d2)` | Days between | `$Datefns.differenceInDays($d1, $d2)` |
| `$Datefns.isBefore($d1, $d2)` | Compare dates | `$Datefns.isBefore($date1, $date2)` |
| `$Datefns.isAfter($d1, $d2)` | Compare dates | `$Datefns.isAfter($date1, $date2)` |

### Common Date Formats

| Format | Example Output |
|--------|----------------|
| `yyyy-MM-dd` | 2026-01-21 |
| `MM/dd/yyyy` | 01/21/2026 |
| `MMMM do, yyyy` | January 21st, 2026 |
| `yyyy-MM-dd HH:mm:ss` | 2026-01-21 14:30:00 |

## Normalizers

| Normalizer | Description | Example |
|------------|-------------|---------|
| `$Normalize.date($str)` | Parse date | `$Normalize.date('2026-01-21')` → ISO string |
| `$Normalize.phone($str)` | Format phone | `$Normalize.phone('5551234567')` → `+1 555 123 4567` |
| `$Normalize.name($str)` | Normalize name | `$Normalize.name('john doe')` → `John Doe` |
| `$Normalize.ssn($str)` | Normalize SSN | `$Normalize.ssn('123-45-6789')` → `123456789` |
| `$Normalize.address($str)` | Parse address | `$Normalize.address($fullAddr)` → `City, ST ZIP` |

## Address Helpers

| Function | Description | Example |
|----------|-------------|---------|
| `$Address.getCityState($city)` | Get state code | `$Address.getCityState('Seattle')` → `WA` |
| `$Address.parse($addr)` | Parse components | `$addr.city`, `$addr.state` |
| `$Address.format($addr)` | Format address | Returns formatted string |

### Address Components

After `#set($addr = $Address.parse($fullAddress))`:
- `$addr.street_address1` - Street address
- `$addr.street_address2` - Apt/Suite
- `$addr.city` - City name
- `$addr.state` - State code
- `$addr.postal_code` - ZIP code

## Control Flow

### If/Else

```velocity
#if($condition)
  true branch
#elseif($otherCondition)
  else if branch
#else
  else branch
#end
```

### Foreach Loop

```velocity
#foreach($item in $collection)
  $item
#end
```

### Set Variable

```velocity
#set($myVar = "value")
#set($calculated = $Math.round($value))
```

## Common Patterns

### Unique Username

```velocity
${firstName}.${lastName}
```
Config: Type=Unique, Case=Lower, Normalize=Yes

### Email Prefix

```velocity
#set($parts = $email.split('@'))
$parts[0]
```

### Employee ID

```velocity
EMP$counter
```
Config: Type=Counter, Start=1000, Digits=5

### Formatted Name

```velocity
$Normalize.name("$firstName $lastName")
```

### Tenure Calculation

```velocity
$Datefns.differenceInYears($Date.now(), $Normalize.date($hireDate))
```

### Fallback to Previous

```velocity
#if($!{email})
  $email
#else
  $previous.email
#end
```

### Source-Specific Attribute

```velocity
#set($adAccounts = $sources.get('Active Directory'))
#if($adAccounts && $adAccounts.size() > 0)
  $adAccounts.get(0).samAccountName
#end
```

### Conditional Format

```velocity
#if($department == 'IT')
  ${firstName}.${lastName}
#else
  ${firstName}${lastName.substring(0,1)}
#end
```

## String Operations

| Operation | Example |
|-----------|---------|
| Concatenate | `${firstName}.${lastName}` |
| Substring | `${email.substring(0, 5)}` |
| Split | `#set($parts = $email.split('@'))` |
| Replace | `${text.replace('old', 'new')}` |
| Lowercase | `${text.toLowerCase()}` |
| Uppercase | `${text.toUpperCase()}` |
| Contains | `#if($text.contains('word'))` |
| Length | `$text.length()` |

## Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `==` | Equal | `#if($a == $b)` |
| `!=` | Not equal | `#if($a != $b)` |
| `>` | Greater than | `#if($a > $b)` |
| `<` | Less than | `#if($a < $b)` |
| `>=` | Greater or equal | `#if($a >= $b)` |
| `<=` | Less or equal | `#if($a <= $b)` |
| `&&` | Logical AND | `#if($a && $b)` |
| `\|\|` | Logical OR | `#if($a \|\| $b)` |
| `!` | Logical NOT | `#if(!$a)` |

## Null Safety

| Pattern | Description |
|---------|-------------|
| `$!{var}` | Return empty string if null |
| `#if($var)` | Check if not null |
| `#if($!{var})` | Check if not null/empty |
| `$var.isEmpty()` | Check if empty (after null check) |

## Debugging

### Display All Context

```velocity
## Show available attributes
#foreach($key in $previous.keySet())
  $key = $previous.get($key)
#end

## Show sources
#foreach($source in $sources.keySet())
  Source: $source
#end
```

### Test Normalizer Output

```velocity
Input: $!{dateString}
Normalized: $!{Normalize.date($dateString)}
```

### Step-by-Step Debug

```velocity
Step 1: $!{firstName}
Step 2: $!{lastName}
Step 3: ${firstName}.${lastName}
```

## Attribute Types

| Type | Description | Counter Support |
|------|-------------|-----------------|
| Normal | Standard attribute | No |
| Unique | Must be unique | Auto-appended |
| UUID | Universally unique | No |
| Counter-based | Sequential numbers | Yes |

## Configuration Options

| Option | Description | Values |
|--------|-------------|--------|
| Case Selection | Transform case | Lower, Upper, Capitalize, None |
| Normalize | Remove special chars | Yes/No |
| Remove Spaces | Remove all spaces | Yes/No |
| Trim | Remove leading/trailing | Yes/No |
| Max Length | Truncate result | Number |
| Refresh | Recalculate each run | Yes/No |
| Counter Digits | Pad counter with zeros | Number |

## Transformation Order

1. Evaluate Velocity expression
2. Apply case transformation
3. Remove spaces (if enabled)
4. Trim spaces (if enabled)
5. Normalize special characters (if enabled)
6. Truncate to max length (if set)
7. Add counter (for unique attributes)

## Tips

✅ **DO**
- Use `$!{variable}` for null safety
- Check normalizers return values
- Test expressions incrementally
- Provide default values
- Use variables for clarity

❌ **DON'T**
- Assume attributes exist
- Use expensive operations in loops
- Forget to check source existence
- Rely on case-sensitive source names
- Mix up previous vs current attributes

---

## Additional Resources

- [Velocity Expressions Guide](VELOCITY_EXPRESSIONS_GUIDE.md) - Comprehensive guide with detailed explanations
- [Velocity Practical Examples](VELOCITY_EXAMPLES.md) - Real-world examples and use cases
