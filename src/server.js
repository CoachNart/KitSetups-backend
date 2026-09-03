require("./config/env");
const http=require("http");
const {authRoutes}=require("./routes/auth");
const {accountRoutes}=require("./routes/account");
const {registerRoutes}=require("./routes/register");
const {signalsRoutes}=require("./routes/signals");
const {signalHistoryRoutes}=require("./routes/signalHistory");
const {analysisRoutes}=require("./routes/analysis");
const {safeRoutes}=require("./routes/analysisSafe");
const {developerRoutes}=require("./routes/developer");
const {paymentRoutes}=require("./routes/payment");
const {startScannerLoop,getScannerRuntimeStatus}=require("./scanner/runner");
const PORT=Number(process.env.PORT||8787);
function sendJson(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type, Authorization, X-API-Key, X-KitSetups-Device, X-KitSetups-Fingerprint","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS"});res.end(JSON.stringify(data));}
const server=http.createServer(async(req,res)=>{if(req.method==="OPTIONS")return sendJson(res,204,{});try{if(req.method==="GET"&&req.url==="/health")return sendJson(res,200,{ok:true,service:"kitsetups-backend",status:"healthy",timestamp:new Date().toISOString(),scanner:getScannerRuntimeStatus()});let handled=await authRoutes(req,res);if(handled!==false)return handled;let accountHandled=await accountRoutes(req,res);if(accountHandled!==false)return accountHandled;let signalHistoryHandled=await signalHistoryRoutes(req,res);if(signalHistoryHandled!==false)return signalHistoryHandled;let signalsHandled=await signalsRoutes(req,res);if(signalsHandled!==false)return signalsHandled;let safeHandled=await safeRoutes(req,res);if(safeHandled!==false)return safeHandled;let analysisHandled=await analysisRoutes(req,res);if(analysisHandled!==false)return analysisHandled;let developerHandled=await developerRoutes(req,res);if(developerHandled!==false)return developerHandled;let paymentHandled=await paymentRoutes(req,res);if(paymentHandled!==false)return paymentHandled;let registerHandled=await registerRoutes(req,res);if(registerHandled!==false)return registerHandled;return sendJson(res,404,{ok:false,error:"Route not found",code:"NOT_FOUND"});}catch(error){console.error("SERVER ERROR:",error);return sendJson(res,500,{ok:false,error:"Internal server error",code:"INTERNAL_ERROR"});}});
server.listen(PORT,"0.0.0.0",()=>{console.log(`🔥 KitSetups backend running on :${PORT}`);startScannerLoop();});
