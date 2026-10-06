// Test-only transport, loaded with node --import. The production collector always uses native fetch.
const now=Date.now();
const market=(ticker,event)=>({ticker,event_ticker:event,title:'Fixture wins',yes_sub_title:'Fixture',yes_bid_dollars:'.48',yes_ask_dollars:'.5',no_bid_dollars:'.5',no_ask_dollars:'.52',last_price_dollars:'.49',previous_price_dollars:'.45',volume_fp:'2000',volume_24h_fp:'1000',close_time:new Date(now+86400000).toISOString(),expected_expiration_time:new Date(now+3600000).toISOString(),status:'active',rules_primary:'Fixture wins the scheduled event.'});
globalThis.fetch=async input=>{
  const url=new URL(input),mode=process.env.PREDICTION_TEST_MODE;
  if(mode==='fail')return new Response('',{status:503});
  if(url.hostname==='robinhood.com'){
    if(!url.pathname.includes('/events/'))return new Response('<a href="/us/en/prediction-markets/pro-football/events/fixture">Fixture</a>');
    return new Response('<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{event:{name:'Fixture event',eventContracts:{a:{symbol:'KXNFLGAME-FIXTURE',exchange:'EXCHANGE_SOURCE_KALSHI',tradability:'EVENT_CONTRACT_TRADABILITY_TRADABLE'},wrong:{symbol:'WRONG',exchange:'OTHER'}}}}}})+'</script>');
  }
  if(url.pathname.endsWith('/candlesticks')){
    if(mode==='partial')return new Response('',{status:503});
    return Response.json({candlesticks:[{end_period_ts:Math.floor(now/1000)-3600,price:{close_dollars:'.4'}},{end_period_ts:Math.floor(now/1000),price:{close_dollars:null}}]});
  }
  if(url.pathname.includes('/historical/markets/ARCHIVED'))return Response.json({market:{...market('ARCHIVED','ARCHIVED-E'),status:'finalized',result:'scalar',settlement_value_dollars:'.5',settlement_ts:new Date(now).toISOString()}});
  if(url.pathname.endsWith('/markets/ARCHIVED'))return new Response('',{status:404});
  if(url.pathname.endsWith('/markets')){
    const series=url.searchParams.get('series_ticker');
    if(mode==='partial'&&series==='KXFED')return new Response('',{status:503});
    if(series!=='KXNFLGAME')return Response.json({markets:[],cursor:''});
    if(url.searchParams.get('cursor'))return Response.json({markets:[market('KXNFLGAME-PAGE2','PAGE2-E')],cursor:''});
    return Response.json({markets:[market('KXNFLGAME-FIXTURE','FIXTURE-E')],cursor:'page2'});
  }
  throw Error('Unexpected request '+url);
};
