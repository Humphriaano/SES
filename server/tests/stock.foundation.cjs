const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');require(root+'/node_modules/dotenv').config({path:root+'/.env',quiet:true});
if(process.env.STOCK_TEST_DATABASE_URL)process.env.DATABASE_URL=process.env.STOCK_TEST_DATABASE_URL;
require(root+'/node_modules/ts-node').register({project:root+'/tsconfig.json',transpileOnly:true});
const {PrismaClient,Prisma}=require(root+'/node_modules/@prisma/client');
const stock=require(root+'/src/lib/stock');
const today=require(root+'/src/lib/prescriptionCourse').todayInput();
if(process.argv.includes('--replay')){
 const payload=JSON.parse(process.env.STOCK_TEST_REPLAY),db=new PrismaClient();
 stock.postStockReceipt(db,payload.actor,payload.key,payload.body).then(r=>console.log(JSON.stringify({replayed:r.replayed,receiptId:r.result.receipt.id}))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
}else main().catch(e=>{console.error(e);process.exitCode=1});

async function main(){
 const originalUrl=process.env.DATABASE_URL;if(!originalUrl)throw Error('Database configuration missing');
 const admin=new PrismaClient(),created=new Set(),clients=[],temporaryDirs=[];let httpServer;let checks=0;
 const pass=message=>{checks++;console.log('PASS '+message)};
 const urlFor=schema=>{const url=new URL(originalUrl);url.searchParams.set('schema',schema);url.searchParams.set('connection_limit','8');return url.toString()};
 const schemaName=tag=>'ses_stock_test_'+tag+'_'+Date.now()+'_'+crypto.randomBytes(4).toString('hex');
 const safeSchema=name=>{if(!/^ses_stock_test_(empty|existing)_\d+_[a-f0-9]{8}$/.test(name)||!created.has(name))throw Error('Unsafe test schema');return '"'+name+'"'};
 async function createSchema(tag){const name=schemaName(tag);created.add(name);await admin.$executeRawUnsafe('CREATE SCHEMA '+safeSchema(name));return name}
 function migrate(schema,baselineOnly=false){
  let schemaPath=root+'/prisma/schema.prisma';
  if(baselineOnly){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ses-stock-baseline-'));temporaryDirs.push(dir);fs.mkdirSync(dir+'/migrations/20261104000000_baseline',{recursive:true});fs.copyFileSync(root+'/prisma/schema.prisma',dir+'/schema.prisma');fs.copyFileSync(root+'/prisma/migrations/20261104000000_baseline/migration.sql',dir+'/migrations/20261104000000_baseline/migration.sql');fs.copyFileSync(root+'/prisma/migrations/migration_lock.toml',dir+'/migrations/migration_lock.toml');schemaPath=dir+'/schema.prisma'}
  const result=spawnSync(process.execPath,[root+'/node_modules/prisma/build/index.js','migrate','deploy','--schema',schemaPath],{cwd:root,env:{...process.env,DATABASE_URL:urlFor(schema)},encoding:'utf8',windowsHide:true});
  if(result.status)throw Error('Isolated migration failed: '+result.stdout+'\n'+result.stderr);
 }
 async function rowHashes(db,schema,tables){const result={};for(const name of tables){assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/);const record=name==='CatalogueDrug'?"(to_jsonb(t) - 'ingredients' - 'pendingReview')":name==='Prescription'?"(to_jsonb(t) - 'preferredStockProductId')":'to_jsonb(t)';const rows=await db.$queryRawUnsafe('SELECT COALESCE(jsonb_agg('+record+' ORDER BY '+record+'::text),\'[]\'::jsonb)::text AS rows FROM '+safeSchema(schema)+'."'+name+'" t');result[name]=crypto.createHash('sha256').update(rows[0].rows).digest('hex')}return result}
 try{
  const empty=await createSchema('empty');migrate(empty);const fresh=new PrismaClient({datasources:{db:{url:urlFor(empty)}}});clients.push(fresh);assert.equal(await fresh.pharmacyProduct.count(),0);assert.equal(await fresh.stockMovement.count(),0);assert.equal(await fresh.patient.count(),0);pass('both migrations apply to an empty isolated schema with no synthetic stock or patient data');
  const existing=await createSchema('existing');migrate(existing,true);const db=new PrismaClient({datasources:{db:{url:urlFor(existing)}}});clients.push(db);
  const staff=await db.user.create({data:{name:'Synthetic pharmacist',email:'stock-fixture@example.test',password:'not-a-login',role:'pharmacist'}}),actor={userId:staff.id,role:'pharmacist'};
  const patient=await db.patient.create({data:{firstName:'Synthetic',lastName:'Stock fixture',dateOfBirth:new Date('2000-01-01'),gender:'FEMALE'}});
  const encounter=await db.encounter.create({data:{patientId:patient.id,clinicianId:staff.id}});
  const medication=await db.medication.create({data:{patientId:patient.id,name:'Legacy fixture medicine',dosage:'500mg',startDate:new Date('2026-01-01'),quantity:9,quantityUnit:'tablet',unitPrice:2,priceBasis:'ITEM',doseUnit:'tablet'}});
  const rx=await db.prescription.create({data:{encounterId:encounter.id,medicationId:medication.id},select:{id:true}});
  const disp=await db.dispensing.create({data:{patientId:patient.id,prescriptionId:rx.id,dispensedDrug:medication.name,dispensedBy:staff.id,quantity:9,unitPrice:2}});
  await db.drugInventory.create({data:{drugName:'Legacy fixture medicine',quantity:123,unit:'tablet'}});
  const priceData=JSON.parse(fs.readFileSync(root+'/data/builtin-price-items.json','utf8')).filter(r=>r.itemType==='DRUG');
  const ors=priceData.find(r=>r.catalogueRef==='STD_ATC_A07CA_205'),tablet=priceData.find(r=>r.name==='Paracetamol'&&/tablet/i.test(r.detail)),liquid=priceData.find(r=>r.catalogueRef==='EM1093');assert.ok(ors&&tablet&&liquid);
  await db.priceListItem.createMany({data:[{...ors,unitPrice:5},{...tablet,unitPrice:null},{...liquid,unit:'per bottle',unitPrice:35,bottleSizeMl:75},{itemType:'DRUG',catalogueRef:'MANUAL_NOT_CLINICAL',name:'Manual price only',unit:'per unit'}]});
  await db.$executeRaw`INSERT INTO "CatalogueDrug" ("id","code","generic","strength","form","route","updatedAt") VALUES ('baseline-custom-drug','CUS_TEST001','Synthetic custom medicine','10mg','Tablet','Oral',CURRENT_TIMESTAMP)`;
  await db.priceListItem.create({data:{itemType:'DRUG',catalogueRef:'CUS_TEST001',name:'Synthetic custom medicine',unit:'per tablet'}});
  const inv=await db.invoice.create({data:{patientId:patient.id,number:'INV-SYNTHETIC-STOCK',status:'PART_PAID'}});
  await db.chargeLine.create({data:{invoiceId:inv.id,patientId:patient.id,sourceType:'PRESCRIPTION',sourceId:rx.id,description:'Synthetic fixture charge',quantity:9,unitPrice:2}});
  await db.payment.create({data:{invoiceId:inv.id,receiptNumber:'RCT-SYNTHETIC-STOCK',amount:5,method:'CASH',receivedById:staff.id}});
  const auditRow=await db.billingAudit.create({data:{userId:staff.id,action:'SYNTHETIC_EXISTING',entity:'Fixture'}});
  const oldTables=(await db.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = ${existing} AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`).map(r=>r.table_name);
  const before=await rowHashes(db,existing,oldTables);migrate(existing);assert.deepEqual(await rowHashes(db,existing,oldTables),before);pass('migration preserves every baseline-table row in a representative existing-data fixture, including invoices, payments and legacy inventory');

  const productBody={catalogueRef:ors.catalogueRef,brand:'Synthetic ORS brand',manufacturer:'Fixture manufacturer',baseUnit:'sachet',packSize:100,packLabel:'box'};
  const products=await Promise.all([stock.createStockProduct(db,actor,'product-0001',productBody),stock.createStockProduct(db,actor,'product-0001',productBody)]);
  assert.equal(products.filter(r=>r.replayed).length,1);assert.equal(products[0].result.id,products[1].result.id);const product=products[0].result;
  await assert.rejects(()=>stock.createStockProduct(db,actor,'product-0001',{...productBody,packSize:10}),e=>e.status===409);
  await assert.rejects(()=>stock.createStockProduct(db,actor,'product-duplicate',{...productBody,brand:' synthetic ORS brand '}),e=>e.status===409);pass('concurrent duplicate operation is posted once, changed payload conflicts, and normalized product identity prevents duplicates');
  await assert.rejects(()=>stock.createStockProduct(db,actor,'bad-source-01',{...productBody,catalogueRef:'MANUAL_NOT_CLINICAL'}),e=>e.status===400);
  await assert.rejects(async()=>stock.createStockProduct(db,actor,'bad-unit-0001',{...productBody,baseUnit:'course'}),e=>e.status===400);
  const unpriced=await stock.createStockProduct(db,actor,'unpriced-prod',{...productBody,catalogueRef:tablet.catalogueRef,brand:'Unpriced tablets',baseUnit:'tablet',packSize:10});assert.ok(unpriced.result.id);
  const custom=await stock.createStockProduct(db,actor,'custom-prod-1',{...productBody,catalogueRef:'CUS_TEST001',brand:'Custom brand',baseUnit:'tablet'});assert.ok(custom.result.id);pass('only exact built-in/custom clinical references accepted; selling price is optional and course is rejected as a physical unit');

  const liquidProduct=(await stock.createStockProduct(db,actor,'liquid-product-1',{...productBody,catalogueRef:liquid.catalogueRef,brand:'Synthetic liquid brand',baseUnit:'mL',packSize:75,packLabel:'bottle'})).result;
  const liquidBatch=(await stock.createStockBatch(db,actor,'liquid-batch-001',{productId:liquidProduct.id,lotNumber:'liquid-a',expiryDate:'2099-12-31'})).result;
  await stock.postStockReceipt(db,actor,'liquid-receipt-1',{reference:'LIQUID-FIXTURE',source:'Fixture source',lines:[{batchId:liquidBatch.id,packCount:2}]});
  await stock.postStockIssue(db,actor,'liquid-issue-001',{catalogueRef:liquid.catalogueRef,baseUnit:'mL',reference:'LIQUID-ISSUE',allocations:[{batchId:liquidBatch.id,quantity:'45.50'}]});assert.equal((await stock.stockBalances(db,actor,liquid.catalogueRef)).products[0].available,'104.50');
  const precisionProduct=(await stock.createStockProduct(db,actor,'precision-product',{...productBody,catalogueRef:liquid.catalogueRef,brand:'Synthetic precision product',baseUnit:'mL',packSize:'0.01',packLabel:'test pack'})).result;
  const precisionBatch=(await stock.createStockBatch(db,actor,'precision-batch-01',{productId:precisionProduct.id,lotNumber:'precision-a',expiryDate:'2099-12-31'})).result;
  await assert.rejects(()=>stock.postStockReceipt(db,actor,'precision-receipt',{reference:'PRECISION-FIXTURE',source:'Fixture source',lines:[{batchId:precisionBatch.id,packCount:'0.01'}]}),e=>e.status===400);pass('physical liquid stock converts two 75 mL bottles to 150 mL, handles decimal issues and rejects silent conversion rounding independently of the K35 price');

  const batch=(await stock.createStockBatch(db,actor,'batch-000001',{productId:product.id,lotNumber:'lot-a',expiryDate:'2099-12-31'})).result;
  const b2=(await stock.createStockBatch(db,actor,'batch-000002',{productId:product.id,lotNumber:'lot-b',expiryDate:'2099-11-30'})).result;
  const quarantined=(await stock.createStockBatch(db,actor,'batch-quarantined',{productId:product.id,lotNumber:'lot-q',expiryDate:'2099-10-31',status:'QUARANTINED'})).result;
  assert.equal((await stock.stockBalances(db,actor,ors.catalogueRef)).products[0].physical,'0.00');assert.equal((await stock.stockBalances(db,actor,'UNKNOWN_NOT_TRACKED')).tracked,false);
  await assert.rejects(async()=>stock.createStockBatch(db,actor,'batch-past-date',{productId:product.id,lotNumber:'past',expiryDate:'2000-01-01'}),e=>e.status===400);pass('batches have no editable balances; untracked and tracked zero-stock items differ; past expiry is rejected');
  const receiptBody={receivedDate:today,reference:'SYNTHETIC-DELIVERY',source:'Fixture source',lines:[{batchId:batch.id,packCount:10,costPerPack:0}]};
  const receipt=await stock.postStockReceipt(db,actor,'receipt-0001',receiptBody);assert.equal(receipt.result.movements[0].quantity,'1000');
  assert.equal((await stock.stockBalances(db,actor,ors.catalogueRef)).products[0].physical,'1000.00');
  const child=spawnSync(process.execPath,[__filename,'--replay'],{cwd:root,env:{...process.env,DATABASE_URL:urlFor(existing),STOCK_TEST_REPLAY:JSON.stringify({actor,key:'receipt-0001',body:receiptBody})},encoding:'utf8',windowsHide:true});assert.equal(child.status,0,child.stderr);const replay=JSON.parse(child.stdout.trim());assert.equal(replay.replayed,true);assert.equal(replay.receiptId,receipt.result.receipt.id);assert.equal(await db.stockReceipt.count({where:{reference:receiptBody.reference}}),1);pass('10 boxes of 100 convert exactly to 1,000 sachets; zero cost is valid; a fresh Node process replays the same receipt after restart');
  const issueBody={catalogueRef:ors.catalogueRef,baseUnit:'sachet',reference:'SYNTHETIC-ISSUE',allocations:[{batchId:batch.id,quantity:600}]};
  const competing=await Promise.allSettled([stock.postStockIssue(db,actor,'issue-concurrent-a',issueBody),stock.postStockIssue(db,actor,'issue-concurrent-b',issueBody)]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.ok(competing.find(r=>r.status==='rejected').reason.status===409);assert.equal((await stock.stockBalances(db,actor,ors.catalogueRef)).products[0].available,'400.00');pass('two concurrent issues against one batch cannot overdraw it');
  await assert.rejects(()=>stock.postStockIssue(db,actor,'wrong-sku-0001',{...issueBody,catalogueRef:tablet.catalogueRef,allocations:[{batchId:batch.id,quantity:1}]}),e=>e.status===409);
  await assert.rejects(()=>stock.postStockIssue(db,actor,'wrong-unit-001',{...issueBody,baseUnit:'bottle',allocations:[{batchId:batch.id,quantity:1}]}),e=>e.status===409);
  const beforeMulti=await db.stockMovement.count();await assert.rejects(()=>stock.postStockIssue(db,actor,'multi-rollback-1',{...issueBody,allocations:[{batchId:batch.id,quantity:100},{batchId:b2.id,quantity:1}]}),e=>e.status===409);assert.equal(await db.stockMovement.count(),beforeMulti);assert.equal(await db.stockOperation.count({where:{key:'multi-rollback-1'}}),0);pass('SKU/unit mismatches fail and a failed multi-batch issue rolls back all its movements and operation record');
  await stock.postStockReceipt(db,actor,'quarantine-receipt',{...receiptBody,lines:[{batchId:quarantined.id,packCount:1}]});
  await assert.rejects(()=>stock.postStockIssue(db,actor,'quarantine-issue',{...issueBody,allocations:[{batchId:quarantined.id,quantity:1}]}),e=>e.status===409);
  await db.stockBatch.update({where:{id:quarantined.id},data:{status:'USABLE',expiryDate:new Date('2000-01-01')}});
  await assert.rejects(()=>stock.postStockIssue(db,actor,'expired-issue-01',{...issueBody,allocations:[{batchId:quarantined.id,quantity:1}]}),e=>e.status===409);let totals=await stock.stockBalances(db,actor,ors.catalogueRef);assert.equal(totals.products[0].expired,'100.00');assert.equal(totals.products[0].available,'400.00');pass('quarantined and expired stock remains physical but cannot be issued');

  await assert.rejects(()=>stock.reverseStockMovement(db,actor,'reverse-used-receipt',{movementId:receipt.result.movements[0].id,reason:'Synthetic correction after issue'}),e=>e.status===409);
  const issued=(await db.stockMovement.findFirst({where:{type:'ISSUED',batchId:batch.id}}));const correction=await stock.reverseStockMovement(db,actor,'reverse-issue-001',{movementId:issued.id,reason:'Synthetic issue correction'});assert.equal(correction.result.quantity,'600');
  await assert.rejects(()=>stock.reverseStockMovement(db,actor,'reverse-twice-001',{movementId:issued.id,reason:'Synthetic duplicate'}),e=>e.status===409);
  await assert.rejects(()=>stock.reverseStockMovement(db,actor,'reverse-chain-001',{movementId:correction.result.id,reason:'Synthetic invalid chain'}),e=>e.status===409);
  await stock.reverseStockMovement(db,actor,'reverse-receipt-1',{movementId:receipt.result.movements[0].id,reason:'Synthetic receipt correction'});assert.equal((await stock.stockBalances(db,actor,ors.catalogueRef)).products[0].available,'0.00');pass('corrections add opposite immutable movements, cannot repeat or chain, and reconcile to the ledger');
  const movement=receipt.result.movements[0];await assert.rejects(()=>db.stockMovement.update({where:{id:movement.id},data:{quantity:9}}));await assert.rejects(()=>db.stockMovement.delete({where:{id:movement.id}}));await assert.rejects(()=>db.stockReceipt.update({where:{id:receipt.result.receipt.id},data:{reference:'edit'}}));
  const operation=await db.stockOperation.findFirst();await assert.rejects(()=>db.stockMovement.create({data:{operationId:operation.id,batchId:batch.id,type:'ISSUED',quantity:-1,baseUnit:'sachet',reference:'RAW-OVERDRAW',actorId:staff.id}}));await assert.rejects(()=>db.stockMovement.create({data:{operationId:operation.id,batchId:batch.id,type:'ISSUED',quantity:-1,baseUnit:'bottle',reference:'RAW-WRONG-UNIT',actorId:staff.id}}));pass('database triggers block direct ledger edits/deletes, receipt edits, unit mismatches and negative balances');
  const defaultDateBody={reference:'DEFAULT-DATE',source:'Fixture source',lines:[{batchId:b2.id,packCount:1}]};
  const dated=await stock.postStockReceipt(db,actor,'date-default-retry',defaultDateBody),courseClock=require(root+'/src/lib/prescriptionCourse'),originalToday=courseClock.todayInput;
  try{courseClock.todayInput=()=> '2100-01-01';const replayDated=await stock.postStockReceipt(db,actor,'date-default-retry',defaultDateBody);assert.equal(replayDated.replayed,true);assert.equal(replayDated.result.receipt.id,dated.result.receipt.id);const oldBatchReplay=await stock.createStockBatch(db,actor,'batch-000001',{productId:product.id,lotNumber:'lot-a',expiryDate:'2099-12-31'});assert.equal(oldBatchReplay.replayed,true);}finally{courseClock.todayInput=originalToday;}pass('idempotent replay remains stable across date changes, including an omitted receipt date and a now-expired batch setup');
  await db.$executeRawUnsafe('CREATE FUNCTION "fixture_reject_stock_audit"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = \'STOCK_RECEIVED\' AND NEW."after"::text LIKE \'%AUDIT-FAIL%\' THEN RAISE EXCEPTION \'fixture audit failure\'; END IF; RETURN NEW; END; $$');
  await db.$executeRawUnsafe('CREATE TRIGGER "fixture_audit_failure" BEFORE INSERT ON "BillingAudit" FOR EACH ROW EXECUTE FUNCTION "fixture_reject_stock_audit"()');
  const counts=await Promise.all([db.stockReceipt.count(),db.stockReceiptLine.count(),db.stockMovement.count(),db.stockOperation.count()]);await assert.rejects(()=>stock.postStockReceipt(db,actor,'audit-failure-001',{...receiptBody,reference:'AUDIT-FAIL',lines:[{batchId:b2.id,packCount:1}]}));assert.deepEqual(await Promise.all([db.stockReceipt.count(),db.stockReceiptLine.count(),db.stockMovement.count(),db.stockOperation.count()]),counts);pass('audit failure rolls back receipt, receipt lines, movements and durable operation atomically');

  await assert.rejects(()=>stock.stockBalances(db,{userId:staff.id,role:'billing'},ors.catalogueRef),e=>e.status===403);await assert.rejects(()=>stock.stockBalances(db,{role:'pharmacist'},ors.catalogueRef),e=>e.status===401);
  // Mount the real router and authentication middleware against the isolated DB.
  require.cache[require.resolve(root+'/src/lib/prisma.ts')].exports={__esModule:true,default:db};
  const jwt=require(root+'/node_modules/jsonwebtoken'),express=require(root+'/node_modules/express');process.env.JWT_SECRET='synthetic-stock-test-secret-not-a-real-credential';
  const nurse=await db.user.create({data:{name:'Synthetic restricted staff',email:'stock-nurse@example.test',password:'not-a-login',role:'nurse'}});
  const stockRouter=require(root+'/src/routes/stock.routes').default,{idempotency}=require(root+'/src/middleware/idempotency');
  const app=express();app.use(express.json());app.use(idempotency);app.use('/api/pharmacy-stock',stockRouter);app.use((e,req,res,next)=>res.status(500).json({error:e.message}));
  httpServer=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server))});const origin='http://127.0.0.1:'+httpServer.address().port;
  const token=id=>jwt.sign({userId:id,role:'admin'},process.env.JWT_SECRET);
  async function http(path,options={}){const r=await fetch(origin+path,{...options,headers:{...(options.auth===false?{}:{Authorization:'Bearer '+token(options.userId||staff.id)}),'Content-Type':'application/json',...(options.key?{'Idempotency-Key':options.key}:{})}});return{status:r.status,body:await r.json().catch(()=>null),replay:r.headers.get('Idempotent-Replay')}}
  assert.equal((await http('/api/pharmacy-stock/balances?catalogueRef='+ors.catalogueRef,{auth:false})).status,401);assert.equal((await http('/api/pharmacy-stock/balances?catalogueRef='+ors.catalogueRef,{userId:nurse.id})).status,403);
  const httpBody={...productBody,brand:'HTTP fixture brand'};let h=await http('/api/pharmacy-stock/products',{method:'POST',key:'http-product-001',body:JSON.stringify(httpBody)});assert.equal(h.status,201);h=await http('/api/pharmacy-stock/products',{method:'POST',key:'http-product-001',body:JSON.stringify(httpBody)});assert.equal(h.status,200);assert.equal(h.replay,'true');h=await http('/api/pharmacy-stock/products',{method:'POST',key:'http-product-001',body:JSON.stringify({...httpBody,packSize:5})});assert.equal(h.status,409);h=await http('/API/PHARMACY-STOCK/products',{method:'POST',key:'http-product-001',body:JSON.stringify({...httpBody,packSize:5})});assert.equal(h.status,409);
  assert.equal((await http('/api/pharmacy-stock/products',{method:'POST',body:JSON.stringify(httpBody)})).status,400);assert.equal((await http('/api/pharmacy-stock/receipts',{method:'POST',key:'invalid-receipt-001',body:'{}'})).status,400);assert.equal((await http('/api/pharmacy-stock/issues',{method:'POST',key:'not-enabled-001',body:'{}'})).status,404);pass('real HTTP routes enforce current DB roles, stable keys and payload conflicts; legacy cache cannot bypass validation; receipt validation and disabled issue routes hold');
  // Added fixture staff are test data; verify all preexisting business rows directly.
  const stableTables=oldTables.filter(name=>!['BillingAudit','User'].includes(name));assert.deepEqual(await rowHashes(db,existing,stableTables),Object.fromEntries(stableTables.map(name=>[name,before[name]])));assert.deepEqual(await db.billingAudit.findUnique({where:{id:auditRow.id}}),auditRow);assert.equal((await db.user.findUnique({where:{id:staff.id}})).role,'pharmacist');assert.equal(await db.stockDispensingAllocation.count(),0);assert.equal((await db.dispensing.findUnique({where:{id:disp.id}})).quantity.toString(),'9');pass('foundation operations leave legacy inventory, clinical care, prices, invoices, payments and existing audit rows untouched');
  console.log(checks+'/'+checks+' PostgreSQL stock foundation checks passed. All writes used disposable schemas.');
  if(process.env.STOCK_TEST_RESULT_FILE)fs.writeFileSync(process.env.STOCK_TEST_RESULT_FILE,JSON.stringify({passed:checks,emptyMigration:true,existingFixtureMigration:true,durableReplayInFreshProcess:true,existingApplicationRowsUntouched:true},null,2));
 }finally{
  if(httpServer)await new Promise(resolve=>httpServer.close(resolve));await Promise.allSettled(clients.map(db=>db.$disconnect()));
  for(const name of created)await admin.$executeRawUnsafe('DROP SCHEMA '+safeSchema(name)+' CASCADE');await admin.$disconnect();
  for(const dir of temporaryDirs){const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.match(path.basename(resolved),/^ses-stock-baseline-[A-Za-z0-9]+$/);fs.rmSync(resolved,{recursive:true,force:true});}
 }
}
