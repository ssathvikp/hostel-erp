$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$here = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$root = $scriptDir
$log = Join-Path $root 'sync.log'
function Log($m) {
  $line = (Get-Date -Format 'HH:mm:ss') + ' ' + $m
  for ($i2 = 0; $i2 -lt 8; $i2++) {
    try { Add-Content -Path $log -Value $line -Encoding utf8 -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 400 }
  }
}
Set-Content -Path $log -Value ('=== sync start ' + (Get-Date)) -Encoding utf8
try {
  $tok = ((Select-String -Path (Join-Path $here '.env.local') -Pattern '^CLICKUP_API_TOKEN=').Line) -replace '^CLICKUP_API_TOKEN=',''
  $script:H = @{ Authorization = $tok; 'Content-Type' = 'application/json' }
} catch { Log ('FATAL token read: ' + $_.Exception.Message); exit 1 }
function Api($method, $url, $body) {
  for ($i = 1; $i -le 5; $i++) {
    try {
      Start-Sleep -Milliseconds 700
      if ($body) { return Invoke-RestMethod -Uri $url -Headers $script:H -Method $method -Body $body }
      return Invoke-RestMethod -Uri $url -Headers $script:H -Method $method
    } catch {
      $code = 0
      try { $code = [int]$_.Exception.Response.StatusCode } catch { }
      Log ('  api error attempt ' + $i + ' status=' + $code + ' : ' + $_.Exception.Message)
      if ($code -eq 429) { Start-Sleep -Seconds 40 }
      elseif ($code -ge 500) { Start-Sleep -Seconds 5 }
      else { throw }
    }
  }
  throw ('api failed after retries: ' + $url)
}
$globalDod = (@(
 '**Definition of Done (applies unless this task overrides it)**',
 '- [ ] Code merged to main; lint and typecheck pass',
 '- [ ] Every acceptance-criteria checkbox verified by hand, or by an automated test where one exists',
 '- [ ] No secrets committed; .env files stay gitignored',
 '- [ ] ClickUp task updated with an implementation summary, files changed and evidence',
 '- [ ] Task closed only after the above - code generation alone never closes a task'
) -join "`n")
function Build-Desc($o) {
  $sec = 'Acceptance Criteria'
  if ($o.sec) { $sec = $o.sec }
  $lines = New-Object System.Collections.ArrayList
  [void]$lines.Add('**What and Why**')
  [void]$lines.Add($o.w)
  [void]$lines.Add('')
  [void]$lines.Add('**' + $sec + '**')
  foreach ($a in $o.ac) {
    $mark = '- [ ] '
    if ($o.chk -eq $false) { $mark = '- ' }
    [void]$lines.Add($mark + $a)
  }
  if ($o.out) { [void]$lines.Add(''); [void]$lines.Add('**Out of scope**'); [void]$lines.Add($o.out) }
  if ($o.f) { [void]$lines.Add(''); [void]$lines.Add('**Affected files (proposed)**'); [void]$lines.Add($o.f) }
  [void]$lines.Add('')
  if ($o.dod) { [void]$lines.Add('**Definition of Done**'); [void]$lines.Add($o.dod) } else { [void]$lines.Add($globalDod) }
  if ($o.h -gt 0) { [void]$lines.Add(''); [void]$lines.Add('**Estimate:** ' + $o.h + ' hours') }
  return ($lines -join "`n")
}
function New-Task($o, $listId, $parentId) {
  $b = @{ name = $o.name; markdown_description = (Build-Desc $o); priority = [int]$o.pri }
  if ($o.h -gt 0) { $b.time_estimate = [int64]($o.h * 3600000) }
  if ($o.tags -and $o.tags.Count -gt 0) { $b.tags = @($o.tags) }
  if ($parentId) { $b.parent = $parentId }
  $url = 'https://api.clickup.com/api/v2/list/' + $listId + '/task'
  try { return (Api 'POST' $url ($b | ConvertTo-Json -Depth 8)) }
  catch { Log ('  retry without tags: ' + $o.name); $b.Remove('tags'); return (Api 'POST' $url ($b | ConvertTo-Json -Depth 8)) }
}
try {
  $ids = Get-Content (Join-Path $root 'targets.json') -Raw -Encoding utf8 | ConvertFrom-Json
  $listMvp = $ids.listMvp
  $listBacklog = $ids.listBacklog
  $spec = New-Object System.Collections.ArrayList
  Get-ChildItem (Join-Path $root 'plan-*.ndjson') | Sort-Object Name | ForEach-Object {
    $raw = (Get-Content $_.FullName -Raw -Encoding utf8).TrimStart([char]0xFEFF)
    foreach ($ln in ($raw -split "`r?`n")) { $t = $ln.Trim(); if ($t.Length -gt 0) { [void]$spec.Add(($t | ConvertFrom-Json)) } }
  }
  Log ('spec items loaded: ' + $spec.Count)
  $existing = @{}
  foreach ($lid in @($listMvp, $listBacklog)) {
    $t = Api 'GET' ('https://api.clickup.com/api/v2/list/' + $lid + '/task?include_closed=true&subtasks=true') $null
    foreach ($x in $t.tasks) { $existing[$x.name] = $x.id }
  }
  Log ('existing tasks in target lists: ' + $existing.Count)
  $created = @{}
  foreach ($o in @($spec | Where-Object { $_.t -eq 'epic' })) {
    $lid = $listMvp
    if ($o.list -eq 'backlog') { $lid = $listBacklog }
    if ($existing.ContainsKey($o.name)) { Log ('SKIP exists: ' + $o.name); $created[$o.k] = @{ id = $existing[$o.name] }; continue }
    $r = New-Task $o $lid $null
    $created[$o.k] = @{ id = $r.id }
    Log ('CREATED epic ' + $o.k + ' -> ' + $r.id)
  }
  foreach ($o in @($spec | Where-Object { $_.t -eq 'task' })) {
    if ($existing.ContainsKey($o.name)) { Log ('SKIP exists: ' + $o.name); $created[$o.k] = @{ id = $existing[$o.name] }; continue }
    $parentTaskId = $null
    if ($o.p) { if ($created.ContainsKey($o.p)) { $parentTaskId = $created[$o.p].id } else { Log ('PARENT MISSING for ' + $o.k + ' -> ' + $o.p) } }
    $r = New-Task $o $listMvp $parentTaskId
    $created[$o.k] = @{ id = $r.id }
    Log ('CREATED task ' + $o.k + ' -> ' + $r.id + ' parent=' + $parentTaskId)
  }
  $depOk = 0; $depFail = 0
  foreach ($o in @($spec | Where-Object { $_.deps -and $_.deps.Count -gt 0 })) {
    if (-not $created.ContainsKey($o.k)) { continue }
    $childId = $created[$o.k].id
    foreach ($d in $o.deps) {
      if (-not $created.ContainsKey($d)) { Log ('DEP SKIP missing key: ' + $d); continue }
      try {
        Api 'POST' ('https://api.clickup.com/api/v2/task/' + $childId + '/dependency') (@{ depends_on = $created[$d].id } | ConvertTo-Json) | Out-Null
        $depOk++
        Log ('DEP OK ' + $o.k + ' depends_on ' + $d)
      } catch { $depFail++; Log ('DEP FAILED ' + $o.k + ' <- ' + $d + ' : ' + $_.Exception.Message) }
    }
  }
  Log ('dependencies: ok=' + $depOk + ' failed=' + $depFail)
  $out = @()
  foreach ($k in $created.Keys) { $out += [PSCustomObject]@{ key = $k; id = $created[$k].id; url = ('https://app.clickup.com/t/' + $created[$k].id) } }
  $out | Sort-Object key | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'created-tasks.json') -Encoding utf8
  Log ('=== sync complete. items=' + $created.Count + ' expected=' + $spec.Count)
} catch { Log ('FATAL: ' + $_.Exception.Message) }



