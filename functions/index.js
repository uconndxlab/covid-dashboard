require('dotenv').config()
const functions = require('firebase-functions');
const parse = require('csv-parse');
const got = require('got');

const admin = require('firebase-admin');
admin.initializeApp();

const mappings = {
    "HV"    : "QuarantineDorm",
    "NO"    : "DormComplex1",
    "NW"    : "DormComplex2",
    "SUB"   : "StudentUnion",
    "TW"    : "DormComplex3",
    "WWTP"  : "WastewaterTreatmentPlant",
    "MANS"  : "IsolationDorm1",
    "SO"    : "DormComplex4",
    "WOOD"  : "LibraryandCentralCampus",
    "STRC"  : "DormComplex5",
    "GARG"  : "ApartmentComplex1",
    "CHOK"  : "ApartmentComplex2",
    "ALUM"  : "ApartmentComplex3",
    "HILL"  : "ApartmentComplex4",
    "GRAD"  : "IsolationDorm2"
}

/**
 * TODO: Unit Tests
 */
exports.importWastewaterData = functions.https.onRequest( async (req, res) => {

    if(req.method !== 'POST') return res.status(403).send("Forbidden");

    /**
     * Build the URL
     * 
     * Prod ENV edits:
     * @url https://console.cloud.google.com/functions/edit/us-central1/importWastewaterData?authuser=1&project=covid-dashboard-f47ce
     */
    let csv = [
        'https://',
        process.env.GITHUB_USER,
        ':',
        process.env.GITHUB_TOKEN,
        '@',
        process.env.RAW_WASTEWATER_URL
    ].join('');

    // Human readable ID for our import job
    const importID = Date();

    // Root Collection for all sample imports
    const rootCollection = process.env.NODE_ENV == 'production' ? 'samples' : 'samplesUnitTests';
    const rootCollectionRef = admin.firestore().collection(rootCollection);

    // The collection for the current import
    const collectionRef = rootCollectionRef.doc( 'imported' ).collection( importID );

    // Where we reference the current sample set. Serves as a pointer later on.
    const currentSampleSetDoc = rootCollectionRef.doc('currentSampleSet');

    // Most recent collection date
    let mostRecentCollectionDate = "";

    //  Storage for all of the "write" promises.
    let writes = [];

    /**
     * Read and parse the CSV stream
     * 
     * @url https://csv.js.org/parse/api/stream/
     */
    let parser = got(csv, { isStream: true }).pipe(parse({
        columns: true,
        trim: true       
    }));

    // Iterate over each record/row in the CSV
    for await (const record of parser) {
        
        // use empty column name as "id"
        let id = record[''];
        delete record[''];

        // Rename locations
        record['location'] = mappings[record['location']];

        if (record.date.replace('-', '') > mostRecentCollectionDate.replace('-', '') && record.date !== 'NA'){
            mostRecentCollectionDate = record.date;
        }

        /**
         * I would batch these, but there's a limit of
         * 500 records, so we'd have to split everything into
         * separate batches. Future me.
         * 
         * TODO:  Split writes into batches
         */
        writes.push(collectionRef.doc(id).set(record));     
        
        //  Use for testing without writing to firestore (comment previous line)
        // writes.push( 
        //     new Promise((resolve, reject) => {
        //         setTimeout(resolve, 10000, 'foo');
        //     }) 
        // );          
    }
    
    // Handle the success or failure of our writes
    return Promise.all(writes).then( async (values) => {
        /**
         * Success! Update the reference to the current data set
         * so everyone can find it among our collections
         */ 
        await currentSampleSetDoc.update({
            "collectionID": importID,
            "mostRecentCollectionDate": mostRecentCollectionDate
        })
        functions.logger.log(`${writes.length} samples were imported.`);
        res.send("Samples were imported");
    }).catch(error => {
        // Fahhk - something went wrong
        functions.logger.log(error);
        res.send("Samples were not imported");
    });
});