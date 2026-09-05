const payloads = {
  A: [{id: 42, xero_account_name:'Existing Acct', benchmark_category_name:'Cat A', notes:'n'}],
  B: [{xero_account_name:'New Acct', benchmark_category_name:'Cat B', notes:'new'}],
  C: [{id: 7, xero_account_name:'Existing Two', benchmark_category_name:'Cat C', notes:''},{xero_account_name:'Fresh Acct', benchmark_category_name:'Cat D', notes:'ok'}],
  D: [{xero_account_name:'Dup Acct', benchmark_category_name:'Cat X'},{xero_account_name:'Dup Acct', benchmark_category_name:'Cat Y'}],
  E: [{id:null, xero_account_name:'Maybe', benchmark_category_name:'Cat Z'}]
}

function clean(body){
  const cleanedRows = body.map((row)=>{
    const base = {
      xero_account_name: String(row.xero_account_name||'').trim(),
      benchmark_category_name: String(row.benchmark_category_name||'').trim(),
      notes: row.notes?String(row.notes):''
    }
    if(row && (row.id || row.id === 0)){
      const parsed = Number(row.id)
      if(!Number.isNaN(parsed)) base.id = parsed
    }
    return base
  })
  const rowsWithId = cleanedRows.filter(r=>typeof r.id === 'number')
  const rowsWithoutId = cleanedRows.filter(r=>typeof r.id !== 'number')
  return {cleanedRows, rowsWithId, rowsWithoutId}
}

for(const k of Object.keys(payloads)){
  console.log('---',k)
  const out = clean(payloads[k])
  console.log('cleanedRows:', JSON.stringify(out.cleanedRows,null,2))
  console.log('rowsWithId:', JSON.stringify(out.rowsWithId,null,2))
  console.log('rowsWithoutId:', JSON.stringify(out.rowsWithoutId,null,2))
}
