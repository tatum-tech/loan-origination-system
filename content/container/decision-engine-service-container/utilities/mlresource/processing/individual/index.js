'use strict';
const periodic = require('periodicjs');
const logger = periodic.logger;
const mathjs = require('mathjs');
const Promisie = require('promisie');
const transformhelpers = require('../../../transformhelpers');
const Matrix = require('ml-matrix');
const DTClassifier = require('@digifi/ml-cart').DecisionTreeClassifier;
const DTRegression = require('@digifi/ml-cart').DecisionTreeRegression;
const RFClassifier = require('ml-random-forest').RandomForestClassifier;
const Brain = require('brain.js');
const helpers = require('../../../helpers');
const getCollectionCounter = helpers.getCollectionCounter;
const { generateProjectedResult } = require('../processing_helpers');
const { mapPredictionToDigiFiScore } = require('../../resourcehelpers');

async function runSingleAWSMachineLearning(req) {
  try {
    if (req.controllerData.mlmodel && req.controllerData.mlmodel.aws) {
      let explainability_results = {};
      let user = req.user;
      let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
      const Mlcase = periodic.datas.get('standard_mlcase');
      let machinelearning = periodic.aws.machinelearning;
      let mlmodel = req.controllerData.mlmodel;
      const scoreanalysis = req.controllerData.scoreanalysis;
      const runIndustryProcessing = mlmodel.industry && scoreanalysis && scoreanalysis.results && scoreanalysis.results.projection_evaluator;
      let unflattenedReqBody = require('flat').unflatten(req.body);
      let ml_inputs = unflattenedReqBody.inputs || {};
      let ml_input_schema = mlmodel.datasource.included_columns || mlmodel.datasource.strategy_data_schema;
      let ml_statistics = mlmodel.datasource.statistics;
      let strategy_data_schema = JSON.parse(ml_input_schema);
      let aws_data_schema_map = JSON.parse(mlmodel.datasource.data_schema).attributes.reduce((aggregate, config, i) => {
        aggregate[ config.attributeName ] = config.attributeType;
        return aggregate;
      }, {});
      let base_variables = Object.keys(strategy_data_schema).reduce((aggregate, variable) => {
        if (variable === 'historical_result') return aggregate;
        aggregate[ variable ] = null;
        return aggregate;
      }, {});
      let ml_variables = Object.assign({}, base_variables, ml_inputs);
      Object.keys(ml_variables).forEach(variable => {
        ml_variables[ variable ] = (strategy_data_schema[ variable ] && strategy_data_schema[ variable ].data_type === 'Number' && typeof ml_variables[ variable ] === 'string') ? ml_variables[ variable ].replace(/,/gi, '') : ml_variables[ variable ];
        if (strategy_data_schema[ variable ] && strategy_data_schema[ variable ].data_type === 'Date') {
          ml_variables[ variable ] = new Date(ml_variables[ variable ]).getTime().toString();
        }
        ml_variables[ variable ] = (typeof ml_variables[ variable ] === 'string') ? transformhelpers.filterCSVSpecialCharacters(ml_variables[ variable ], true) : ml_variables[ variable ];
      });
      let params = {
        MLModelId: mlmodel.aws.real_time_prediction_id,
        PredictEndpoint: mlmodel.aws.real_time_endpoint,
        Record: ml_variables,
      };
      let count = await getCollectionCounter('standard_mlcase');
      // input result
      let result = await machinelearning.predict(params).promise();
      let original_prediction = null;
      let digifi_score = null;
      if (mlmodel.type === 'binary' && runIndustryProcessing) {
        const resultPredictionVal = result.Prediction.predictedScores[ result.Prediction.predictedLabel ];
        original_prediction = resultPredictionVal;
        digifi_score = mapPredictionToDigiFiScore(resultPredictionVal);
        result.Prediction.predictedScores[ result.Prediction.predictedLabel ] = generateProjectedResult(scoreanalysis, resultPredictionVal);
      }
      // explainability result
      let run_explainability = false;
      if (req.processing_type && req.processing_type === 'batch') {
        run_explainability = req.return_top_contributors || false;
      } else {
        run_explainability = (req.body && req.body.client_id && !req.body.return_top_contributors) ? false : true;
      }
      let averages = {};
      if (run_explainability) {
        await Promise.all(Object.keys(ml_variables).map(async (variable) => {
          let new_variable_value = null;
          if (strategy_data_schema[ variable ] && strategy_data_schema[ variable ].data_type === 'Number') {
            if (aws_data_schema_map[ variable ] === 'CATEGORICAL') new_variable_value = (ml_statistics[ variable ] && ml_statistics[ variable ].mode !== undefined) ? String(ml_statistics[ variable ].mode) : null;
            else new_variable_value = (ml_statistics[ variable ] && ml_statistics[ variable ].mean !== undefined) ? String(ml_statistics[ variable ].mean) : null;
          } else if (strategy_data_schema[ variable ] && (strategy_data_schema[ variable ].data_type === 'String' || strategy_data_schema[ variable ].data_type === 'Boolean') && ml_statistics[ variable ].mode !== undefined) new_variable_value = ml_statistics[ variable ].mode || null;
          averages[ variable ] = new_variable_value;
          let adjusted_params = Object.assign({}, params, {
            Record: Object.assign({}, ml_variables, {
              [ `${variable}` ]: new_variable_value,
            })
          })
          explainability_results[ variable ] = await machinelearning.predict(adjusted_params).promise();
          // const predictionVal = explainability_results[ variable ].Prediction.predictedScores[ result.Prediction.predictedLabel ];
          // if (runIndustryProcessing) explainability_results[ variable ].Prediction.predictedScores[ result.Prediction.predictedLabel ] = generateProjectedResult(scoreanalysis, predictionVal);
        }));
      }

      let single_ml_result = {
        inputs: ml_variables,
        original_prediction,
        prediction: result,
        digifi_score,
        industry: mlmodel.industry || null,
        mlmodel: mlmodel._id ? mlmodel._id.toString() : null,
        decision_name: req.body.decision_name || `Case ${count}`,
        explainability_results,
        averages,
        provider: 'aws',
        model_name: mlmodel.display_name,
        processing_type: 'individual',
        model_type: mlmodel.type,
        user: user._id.toString(),
        organization,
        case_number: '',
      };
      return single_ml_result;
    } else {
      return null;
    }
  } catch (e) {
    logger.warn('Error in runSingleAWSMachineLearning', e);
    return e;
  }
}

function formatDataTypeColumns({ columnTypes, csv_headers, rows }) {
  try {
    let transposedrows = mathjs.transpose(rows);
    csv_headers.forEach((header, idx) => {
      if (columnTypes[ header ] === 'Date') {
        transposedrows[ idx ] = transposedrows[ idx ].map(celldata => (typeof celldata === 'string') ? new Date(celldata).getTime() : celldata);
      } else if (columnTypes[ header ] === 'Number') {
        transposedrows[ idx ] = transposedrows[ idx ].map(celldata => (typeof celldata === 'string' && celldata.length) ? parseFloat(celldata.replace(/,/gi, '')) : celldata);
      }
    });
    return transposedrows;
  } catch (e) {
    return e;
  }
}

function oneHotEncodeValues({ transposed_rows, columnTypes, encoders, decoders, encoder_counts, csv_headers }) {
  try {
    let hot_encoded_rows = transposed_rows.map((column, idx) => {
      let header = csv_headers[ idx ];
      if (columnTypes[ header ] === 'String' || columnTypes[ header ] === 'Boolean') {
        return column.map(data => {
          if (!isNaN(encoders[ header ][ data ])) return encoders[ header ][ data ];
          else return encoder_counts[ header ];
        });
      } else {
        return column;
      }
    });
    return hot_encoded_rows;
  } catch (e) {
    return e;
  }
}

async function runSingleSagemakerLL(req) {
  try {
    if (req.controllerData.mlmodel && req.controllerData.mlmodel.sagemaker_ll) {
      let explainability_results = {};
      const Mlcase = periodic.datas.get('standard_mlcase');
      let user = req.user;
      let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
      let mlmodel = req.controllerData.mlmodel;
      const scoreanalysis = req.controllerData.scoreanalysis;
      const runIndustryProcessing = mlmodel.industry && scoreanalysis && scoreanalysis.results && scoreanalysis.results.projection_evaluator;
      let provider = req.controllerData.mlmodel.sagemaker_ll;
      let datasource = mlmodel.datasource;
      let statistics = datasource.statistics;
      let ml_input_schema = datasource.included_columns || datasource.strategy_data_schema;
      let strategy_data_schema = JSON.parse(ml_input_schema);
      let transformations = datasource.transformations;
      let provider_datasource = datasource.providers.sagemaker_ll;
      let datasource_headers = provider_datasource.headers.filter(header => header !== 'historical_result');
      let unflattenedReqBody = require('flat').unflatten(req.body);
      let ml_variables = {};
      let features = datasource_headers.map((hd, idx) => {
        ml_variables[ hd ] = (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined) ? unflattenedReqBody.inputs[ hd ] : '';
        return (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined && typeof unflattenedReqBody.inputs[ hd ] === 'string')
          ? transformhelpers.filterCSVSpecialCharacters(unflattenedReqBody.inputs[ hd ], true)
          : (unflattenedReqBody.inputs)
            ? unflattenedReqBody.inputs[ hd ]
            : '';
      });
      let columnTypes = {};
      for (let [ key, val, ] of Object.entries(strategy_data_schema)) {
        columnTypes[ key ] = val.data_type;
      }
      let transposed_rows = formatDataTypeColumns({ columnTypes, csv_headers: datasource_headers, rows: [ features ] })
      let hot_encoded = oneHotEncodeValues({ transposed_rows, columnTypes, encoders: datasource.encoders, decoders: datasource.decoders, encoder_counts: datasource.encoder_counts, csv_headers: datasource_headers, })
      let cleaned = hot_encoded.map((column, idx) => {
        let header = datasource_headers[ idx ];
        let mean = statistics[ header ].mean;
        return column.map(elmt => (typeof elmt !== 'number') ? mean : elmt);
      });
      if (columnTypes[ 'historical_result' ] === 'Boolean' || columnTypes[ 'historical_result' ] === 'Number') {
        cleaned = cleaned.map((column, idx) => {
          let header = datasource_headers[ idx ];
          if (columnTypes[ header ] === 'Number' && transformations[ header ] && transformations[ header ].evaluator) {
            let applyTransformFunc = new Function('x', transformations[ header ].evaluator); 
            return column.map(applyTransformFunc);
          } else {
            return column;
          }
        });
      }
      cleaned = mathjs.transpose(cleaned)[ 0 ];
      var sagemakerruntime = periodic.aws.sagemakerruntime;
      let params = {
        Body: cleaned.join(', '),
        EndpointName: mlmodel.sagemaker_ll.real_time_prediction_id,
        ContentType: 'text/csv',
      };
      let result = await sagemakerruntime.invokeEndpoint(params).promise();
      result = JSON.parse(Buffer.from(result.Body).toString('utf8'));
      let digifi_score = null;
      let original_prediction = null;
      if (mlmodel.type === 'binary') {
        if (runIndustryProcessing) {
          original_prediction = result.predictions[ 0 ].score;
          digifi_score = mapPredictionToDigiFiScore(original_prediction);
          result.predictions[ 0 ].score = generateProjectedResult(scoreanalysis, original_prediction);
        }
      }
      let count = await getCollectionCounter('standard_mlcase');
      let run_explainability = false;
      if (req.processing_type && req.processing_type === 'batch') {
        run_explainability = req.return_top_contributors || false;
      } else {
        run_explainability = (req.body && req.body.client_id && !req.body.return_top_contributors) ? false : true;
      }
      let averages = {};
      if (run_explainability) {
        await Promise.all(datasource_headers.map(async (header, i) => {
          let new_cleaned = cleaned.slice();
          if (strategy_data_schema[ header ] && strategy_data_schema[ header ].data_type === 'Number') {
            new_cleaned[ i ] = (statistics[ header ] && statistics[ header ].mean !== undefined) ? statistics[ header ].mean : null;
            averages[ header ] = new_cleaned[ i ];
            if (transformations && transformations[ header ] && transformations[ header ].evaluator) {
              let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
              new_cleaned[ i ] = applyTransformFunc(new_cleaned[ i ]);
            }
          } else if (strategy_data_schema[ header ] && (strategy_data_schema[ header ].data_type === 'String' || strategy_data_schema[ header ].data_type === 'Boolean') && statistics[ header ].mode !== undefined) {
            new_cleaned[ i ] = statistics[ header ].mode || null;
            averages[ header ] = new_cleaned[ i ];
            if (new_cleaned[ i ] !== undefined && datasource.encoders[ header ] && datasource.encoders[ header ][ new_cleaned[ i ] ] !== undefined) {
              new_cleaned[ i ] = datasource.encoders[ header ][ new_cleaned[ i ] ];
            } else {
              new_cleaned[ i ] = datasource.encoder_counts[ header ];
            }
          }
          let adjusted_params = {
            Body: new_cleaned.join(', '),
            EndpointName: mlmodel.sagemaker_ll.real_time_prediction_id,
            ContentType: 'text/csv',
          };
          let explainability_result = await sagemakerruntime.invokeEndpoint(adjusted_params).promise();
          explainability_results[ header ] = JSON.parse(Buffer.from(explainability_result.Body).toString('utf8'));
          // explainability_results[ header ] = runIndustryProcessing ? generateProjectedResult(scoreanalysis, JSON.parse(Buffer.from(explainability_result.Body).toString('utf8'))) : JSON.parse(Buffer.from(explainability_result.Body).toString('utf8'));
        }));
      }

      let single_ml_result = {
        inputs: ml_variables,
        original_prediction,
        prediction: result,
        digifi_score,
        industry: mlmodel.industry || null,
        decision_name: req.body.decision_name || `Case ${count}`,
        explainability_results,
        averages,
        model_name: mlmodel.display_name,
        provider: 'sagemaker_ll',
        decoder: datasource.decoders,
        processing_type: 'individual',
        mlmodel: mlmodel._id ? mlmodel._id.toString() : null,
        model_type: mlmodel.type,
        user: user._id.toString(),
        organization,
        case_number: '',
      };
      return single_ml_result;
    } else {
      return null;
    }
  } catch (e) {
    console.log({ e });
    logger.warn('Error in runSingleSagemakerLL', e);
    return e;
  }
}

async function runSingleSagemakerXGB(req) {
  try {
    if (req.controllerData.mlmodel && req.controllerData.mlmodel.sagemaker_xgb) {
      let explainability_results = {};
      const Mlcase = periodic.datas.get('standard_mlcase');
      let user = req.user;
      let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
      let mlmodel = req.controllerData.mlmodel;
      const scoreanalysis = req.controllerData.scoreanalysis;
      const runIndustryProcessing = mlmodel.industry && scoreanalysis && scoreanalysis.results && scoreanalysis.results.projection_evaluator;
      let provider = req.controllerData.mlmodel.sagemaker_xgb;
      let datasource = mlmodel.datasource;
      let statistics = datasource.statistics;
      let ml_input_schema = datasource.included_columns || datasource.strategy_data_schema;
      let strategy_data_schema = JSON.parse(ml_input_schema);
      let transformations = datasource.transformations;
      let provider_datasource = datasource.providers.sagemaker_xgb;
      let datasource_headers = provider_datasource.headers.filter(header => header !== 'historical_result');
      let unflattenedReqBody = require('flat').unflatten(req.body);
      let ml_variables = {};
      let features = datasource_headers.map((hd, idx) => {
        ml_variables[ hd ] = (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined) ? unflattenedReqBody.inputs[ hd ] : '';
        return (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined && typeof unflattenedReqBody.inputs[ hd ] === 'string')
          ? transformhelpers.filterCSVSpecialCharacters(unflattenedReqBody.inputs[ hd ], true)
          : (unflattenedReqBody.inputs)
            ? unflattenedReqBody.inputs[ hd ]
            : '';
      });
      let columnTypes = {};
      for (let [ key, val, ] of Object.entries(strategy_data_schema)) {
        columnTypes[ key ] = val.data_type;
      }
      let transposed_rows = formatDataTypeColumns({ columnTypes, csv_headers: datasource_headers, rows: [ features ] });
      let hot_encoded = oneHotEncodeValues({ transposed_rows, columnTypes, encoders: datasource.encoders, decoders: datasource.decoders, encoder_counts: datasource.encoder_counts, csv_headers: datasource_headers, })
      let cleaned = hot_encoded.map((column, idx) => {
        let header = datasource_headers[ idx ];
        let mean = statistics[ header ].mean;
        return column.map(elmt => (typeof elmt !== 'number') ? mean : elmt);
      });
      if (columnTypes[ 'historical_result' ] === 'Boolean' || columnTypes[ 'historical_result' ] === 'Number') {
        cleaned = cleaned.map((column, idx) => {
          let header = datasource_headers[ idx ];
          if (columnTypes[ header ] === 'Number' && transformations[ header ] && transformations[ header ].evaluator) {
            let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
            return column.map(applyTransformFunc);
          } else {
            return column;
          }
        });
      }
      cleaned = mathjs.transpose(cleaned)[ 0 ];
      var sagemakerruntime = periodic.aws.sagemakerruntime;
      let params = {
        Body: cleaned.join(', '),
        EndpointName: mlmodel.sagemaker_xgb.real_time_prediction_id,
        ContentType: 'text/csv',
      };
      let result = await sagemakerruntime.invokeEndpoint(params).promise();
      result = JSON.parse(Buffer.from(result.Body).toString('utf8'));
      let original_prediction = null;
      let digifi_score = null;
      if (mlmodel.type === 'binary') {
        if (runIndustryProcessing) {
          original_prediction = result;
          digifi_score = mapPredictionToDigiFiScore(result);
          result = generateProjectedResult(scoreanalysis, result);
        }
      }
      let count = await getCollectionCounter('standard_mlcase');
      let averages = {};
      let run_explainability = false;
      if (req.processing_type && req.processing_type === 'batch') {
        run_explainability = req.return_top_contributors || false;
      } else {
        run_explainability = (req.body && req.body.client_id && !req.body.return_top_contributors) ? false : true;
      }
      if (run_explainability) {
        await Promise.all(datasource_headers.map(async (header, i) => {
          try {
            let new_cleaned = [...cleaned];
            if (strategy_data_schema[ header ] && strategy_data_schema[ header ].data_type === 'Number') {
              new_cleaned[ i ] = (statistics[ header ] && statistics[ header ].mean !== undefined) ? statistics[ header ].mean : null;
              averages[ header ] = new_cleaned[ i ];
              if (transformations && transformations[ header ] && transformations[ header ].evaluator) {
                let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
                new_cleaned[ i ] = applyTransformFunc(new_cleaned[ i ]);
              }
            } else if (strategy_data_schema[ header ] && (strategy_data_schema[ header ].data_type === 'String' || strategy_data_schema[ header ].data_type === 'Boolean') && statistics[ header ].mode !== undefined) {
              new_cleaned[ i ] = statistics[ header ].mode || null;
              averages[ header ] = new_cleaned[ i ];
              if (new_cleaned[ i ] !== undefined && datasource.encoders[ header ] && datasource.encoders[ header ][ new_cleaned[ i ] ] !== undefined) {
                new_cleaned[ i ] = datasource.encoders[ header ][ new_cleaned[ i ] ];
              } else {
                new_cleaned[ i ] = datasource.encoder_counts[ header ];
              }
            }
            let adjusted_params = {
              Body: new_cleaned.join(', '),
              EndpointName: mlmodel.sagemaker_xgb.real_time_prediction_id,
              ContentType: 'text/csv',
            };
            let explainability_result = await sagemakerruntime.invokeEndpoint(adjusted_params).promise();
            explainability_results[ header ] = JSON.parse(Buffer.from(explainability_result.Body).toString('utf8'));
            // explainability_results[ header ] = runIndustryProcessing ? generateProjectedResult(scoreanalysis, JSON.parse(Buffer.from(explainability_result.Body).toString('utf8'))) : JSON.parse(Buffer.from(explainability_result.Body).toString('utf8'));

          } catch (e) {
            return e;
          }
        }));
      }
      let single_ml_result = {
        inputs: ml_variables,
        original_prediction,
        prediction: result,
        digifi_score,
        industry: mlmodel.industry || null,
        decision_name: req.body.decision_name || `Case ${count}`,
        explainability_results,
        averages,
        model_name: mlmodel.display_name,
        provider: 'sagemaker_xgb',
        decoder: datasource.decoders,
        processing_type: 'individual',
        mlmodel: mlmodel._id ? mlmodel._id.toString() : null,
        model_type: mlmodel.type,
        user: user._id.toString(),
        organization,
        case_number: '',
      };
      return single_ml_result;
    } else {
      return null;
    }
  } catch (e) {
    logger.warn('Error in runSingleSagemakerXGB', e);
    return e;
  }
}

function runDecisionTreePrediction(dataset) {
  let toPredict = Matrix.Matrix.checkMatrix(dataset);
  var predictions = new Array(toPredict.rows);
  for (var i = 0; i < toPredict.rows; ++i) {
    predictions[ i ] = this.root.classify(toPredict.getRow(i))[ 0 ][ 1 ] || 0;
  }
  return predictions;
}

function runDecisionTreePredictionCategorical(dataset) {
  let toPredict = Matrix.Matrix.checkMatrix(dataset);
  var predictions = new Array(toPredict.rows);
  for (var i = 0; i < toPredict.rows; ++i) {
    predictions[ i ] = this.root.classify(toPredict.getRow(i))[ 0 ];
  }
  return predictions;
}

async function runSingleDecisionTree(req) {
  try {
    if (req.controllerData.mlmodel && req.controllerData.mlmodel.decision_tree) {
      let explainability_results = {};
      const Mlcase = periodic.datas.get('standard_mlcase');
      let user = req.user;
      let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
      let mlmodel = req.controllerData.mlmodel;
      const scoreanalysis = req.controllerData.scoreanalysis;
      const runIndustryProcessing = mlmodel.industry && scoreanalysis && scoreanalysis.results && scoreanalysis.results.projection_evaluator;
      let provider = req.controllerData.mlmodel.decision_tree;
      let datasource = mlmodel.datasource;
      let statistics = datasource.statistics;
      let ml_input_schema = datasource.included_columns || datasource.strategy_data_schema;
      let strategy_data_schema = JSON.parse(ml_input_schema);
      let transformations = datasource.transformations;
      let provider_datasource = datasource.providers.digifi;
      let datasource_headers = provider_datasource.headers.filter(header => header !== 'historical_result');
      let unflattenedReqBody = require('flat').unflatten(req.body);
      let ml_variables = {};
      let features = datasource_headers.map((hd, idx) => {
        ml_variables[ hd ] = (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined) ? unflattenedReqBody.inputs[ hd ] : '';
        return (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined && typeof unflattenedReqBody.inputs[ hd ] === 'string')
          ? transformhelpers.filterCSVSpecialCharacters(unflattenedReqBody.inputs[ hd ], true)
          : (unflattenedReqBody.inputs)
            ? unflattenedReqBody.inputs[ hd ]
            : '';
      });
      let columnTypes = {};
      for (let [ key, val, ] of Object.entries(strategy_data_schema)) {
        columnTypes[ key ] = val.data_type;
      }
      let transposed_rows = formatDataTypeColumns({ columnTypes, csv_headers: datasource_headers, rows: [ features ] })
      let hot_encoded = oneHotEncodeValues({ transposed_rows, columnTypes, encoders: datasource.encoders, decoders: datasource.decoders, encoder_counts: datasource.encoder_counts, csv_headers: datasource_headers, })
      let cleaned = hot_encoded.map((column, idx) => {
        let header = datasource_headers[ idx ];
        let mean = statistics[ header ].mean;
        return column.map(elmt => (typeof elmt !== 'number') ? mean : elmt);
      });
      if (columnTypes[ 'historical_result' ] === 'Boolean' || columnTypes[ 'historical_result' ] === 'Number') {
        cleaned = cleaned.map((column, idx) => {
          let header = datasource_headers[ idx ];
          if (columnTypes[ header ] === 'Number' && transformations[ header ] && transformations[ header ].evaluator) {
            let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
            return column.map(applyTransformFunc);
          } else {
            return column;
          }
        });
      }
      cleaned = mathjs.transpose(cleaned);
      const model_config = JSON.parse(provider.model);
      const classifier = (mlmodel.type === 'regression') ? DTRegression.load(model_config) : DTClassifier.load(model_config);
      let prediction = (mlmodel.type === 'binary') ? runDecisionTreePrediction.call(classifier, cleaned) : (mlmodel.type === 'categorical') ? runDecisionTreePredictionCategorical.call(classifier, cleaned) : classifier.predict(cleaned);
      prediction = prediction[ 0 ];
      let original_prediction = null;
      let digifi_score = null;
      if (mlmodel.type === 'binary') {
        if (runIndustryProcessing) {
          original_prediction = prediction;
          digifi_score = mapPredictionToDigiFiScore(prediction);
          prediction = generateProjectedResult(scoreanalysis, prediction);
        }
      }
      let count = await getCollectionCounter('standard_mlcase');
      let run_explainability = false;
      if (req.processing_type && req.processing_type === 'batch') {
        run_explainability = req.return_top_contributors || false;
      } else {
        run_explainability = (req.body && req.body.client_id && !req.body.return_top_contributors) ? false : true;
      }
      let averages = {};
      if (run_explainability) {
        await Promise.all(datasource_headers.map(async (header, i) => {
          let new_cleaned = cleaned[ 0 ].slice();
          if (strategy_data_schema[ header ] && strategy_data_schema[ header ].data_type === 'Number') {
            new_cleaned[ i ] = (statistics[ header ] && statistics[ header ].mean !== undefined) ? statistics[ header ].mean : null;
            averages[ header ] = new_cleaned[ i ];
            if (transformations && transformations[ header ] && transformations[ header ].evaluator) {
              let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
              new_cleaned[ i ] = applyTransformFunc(new_cleaned[ i ]);
            }
          } else if (strategy_data_schema[ header ] && (strategy_data_schema[ header ].data_type === 'String' || strategy_data_schema[ header ].data_type === 'Boolean') && statistics[ header ].mode !== undefined) {
            new_cleaned[ i ] = statistics[ header ].mode || null;
            averages[ header ] = new_cleaned[ i ];
            if (new_cleaned[ i ] !== undefined && datasource.encoders[ header ] && datasource.encoders[ header ][ new_cleaned[ i ] ] !== undefined) {
              new_cleaned[ i ] = datasource.encoders[ header ][ new_cleaned[ i ] ];
            } else {
              new_cleaned[ i ] = datasource.encoder_counts[ header ];
            }
          }
          let explainability_result = (mlmodel.type === 'binary') ? runDecisionTreePrediction.call(classifier, [ new_cleaned ]) : (mlmodel.type === 'categorical')? runDecisionTreePredictionCategorical.call(classifier, [new_cleaned]) : classifier.predict([new_cleaned]);
          explainability_results[ header ] = explainability_result[ 0 ];
          // explainability_results[ header ] = runIndustryProcessing ? generateProjectedResult(scoreanalysis, explainability_result[ 0 ]) : explainability_result[ 0 ];
        }));
      }

      let single_ml_result = {
        inputs: ml_variables,
        original_prediction,
        prediction,
        digifi_score,
        decision_name: req.body.decision_name || `Case ${count}`,
        explainability_results,
        averages,
        industry: mlmodel.industry || null,
        model_name: mlmodel.display_name,
        provider: 'decision_tree',
        decoder: datasource.decoders,
        processing_type: 'individual',
        mlmodel: mlmodel._id ? mlmodel._id.toString() : null,
        model_type: mlmodel.type,
        user: user._id.toString(),
        organization,
        case_number: '',
      };
      return single_ml_result;
    } else {
      return null;
    }
  } catch (e) {
    logger.warn('Error in runSingleSagemakerLL', e);
    return e;
  }
}

function runRandomForestPrediction(toPredict) {
  try {
    let predictionValues = new Array(this.nEstimators);
    toPredict = Matrix.Matrix.checkMatrix(toPredict);
    for (var i = 0; i < this.nEstimators; ++i) {
      let X = toPredict.columnSelectionView(this.indexes[ i ]);
      predictionValues[ i ] = runDecisionTreePrediction.call(this.estimators[ i ], X);
    }
    predictionValues = new Matrix.WrapperMatrix2D(predictionValues).transposeView();
    let predictions = new Array(predictionValues.rows);
    for (i = 0; i < predictionValues.rows; ++i) {
      predictions[ i ] = this.selection(predictionValues.getRow(i));
    }
    return predictions;
  } catch (e) {
    return e;
  }
}

function runRandomForestPredictionCategorical(toPredict) {
  try {
    let predictionValues = new Array(this.nEstimators);
    toPredict = Matrix.Matrix.checkMatrix(toPredict);
    for (var i = 0; i < this.nEstimators; ++i) {
      let X = toPredict.columnSelectionView(this.indexes[ i ]);
      predictionValues[ i ] = runDecisionTreePredictionCategorical.call(this.estimators[ i ], X);
    }
    predictionValues = new Matrix.WrapperMatrix2D(predictionValues).transposeView();
    let predictions = new Array(predictionValues.rows);
    for (i = 0; i < predictionValues.rows; ++i) {
      predictions[ i ] = this.selection(predictionValues.getRow(i));
    }
    return predictions;
  } catch (e) {
    return e;
  }
}

async function runSingleRandomForest(req) {
  try {
    if (req.controllerData.mlmodel && req.controllerData.mlmodel.random_forest) {
      let explainability_results = {};
      const Mlcase = periodic.datas.get('standard_mlcase');
      let user = req.user;
      let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
      let mlmodel = req.controllerData.mlmodel;
      const scoreanalysis = req.controllerData.scoreanalysis;
      const runIndustryProcessing = mlmodel.industry && scoreanalysis && scoreanalysis.results && scoreanalysis.results.projection_evaluator;
      let provider = req.controllerData.mlmodel.random_forest;
      let datasource = mlmodel.datasource;
      let statistics = datasource.statistics;
      let ml_input_schema = datasource.included_columns || datasource.strategy_data_schema;
      let strategy_data_schema = JSON.parse(ml_input_schema);
      let transformations = datasource.transformations;
      let provider_datasource = datasource.providers.digifi;
      let datasource_headers = provider_datasource.headers.filter(header => header !== 'historical_result');
      let unflattenedReqBody = require('flat').unflatten(req.body);
      let ml_variables = {};
      let features = datasource_headers.map((hd, idx) => {
        ml_variables[ hd ] = (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined) ? unflattenedReqBody.inputs[ hd ] : '';
        return (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined && typeof unflattenedReqBody.inputs[ hd ] === 'string')
          ? transformhelpers.filterCSVSpecialCharacters(unflattenedReqBody.inputs[ hd ], true)
          : (unflattenedReqBody.inputs)
            ? unflattenedReqBody.inputs[ hd ]
            : '';
      });
      let columnTypes = {};
      for (let [ key, val, ] of Object.entries(strategy_data_schema)) {
        columnTypes[ key ] = val.data_type;
      }
      let transposed_rows = formatDataTypeColumns({ columnTypes, csv_headers: datasource_headers, rows: [ features ] })
      let hot_encoded = oneHotEncodeValues({ transposed_rows, columnTypes, encoders: datasource.encoders, decoders: datasource.decoders, encoder_counts: datasource.encoder_counts, csv_headers: datasource_headers, })
      let cleaned = hot_encoded.map((column, idx) => {
        let header = datasource_headers[ idx ];
        let mean = statistics[ header ].mean;
        return column.map(elmt => (typeof elmt !== 'number') ? mean : elmt);
      });
      if (columnTypes[ 'historical_result' ] === 'Boolean' || columnTypes[ 'historical_result' ] === 'Number') {
        cleaned = cleaned.map((column, idx) => {
          let header = datasource_headers[ idx ];
          if (columnTypes[ header ] === 'Number' && transformations[ header ] && transformations[ header ].evaluator) {
            let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
            return column.map(applyTransformFunc);
          } else {
            return column;
          }
        });
      }
      cleaned = mathjs.transpose(cleaned);
      const model_config = JSON.parse(provider.model);
      const classifier = RFClassifier.load(model_config);
      let prediction = (mlmodel.type === 'binary') ? runRandomForestPrediction.call(classifier, cleaned) : runRandomForestPredictionCategorical.call(classifier, cleaned);
      prediction = prediction[ 0 ];
      let original_prediction = null;
      let digifi_score = null;
      if (mlmodel.type === 'binary') {
        if (runIndustryProcessing) {
          original_prediction = prediction;
          digifi_score = mapPredictionToDigiFiScore(prediction);
          prediction = generateProjectedResult(scoreanalysis, prediction);
        }
      }
      let count = await getCollectionCounter('standard_mlcase');
      let run_explainability = false;
      if (req.processing_type && req.processing_type === 'batch') {
        run_explainability = req.return_top_contributors || false;
      } else {
        run_explainability = (req.body && req.body.client_id && !req.body.return_top_contributors) ? false : true;
      }
      let averages = {};
      if (run_explainability) {
        await Promise.all(datasource_headers.map(async (header, i) => {
          let new_cleaned = cleaned[ 0 ].slice();
          if (strategy_data_schema[ header ] && strategy_data_schema[ header ].data_type === 'Number') {
            new_cleaned[ i ] = (statistics[ header ] && statistics[ header ].mean !== undefined) ? statistics[ header ].mean : null;
            averages[ header ] = new_cleaned[ i ];
            if (transformations && transformations[ header ] && transformations[ header ].evaluator) {
              let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
              new_cleaned[ i ] = applyTransformFunc(new_cleaned[ i ]);
            }
          } else if (strategy_data_schema[ header ] && (strategy_data_schema[ header ].data_type === 'String' || strategy_data_schema[ header ].data_type === 'Boolean') && statistics[ header ].mode !== undefined) {
            new_cleaned[ i ] = statistics[ header ].mode || null;
            averages[ header ] = new_cleaned[ i ];
            if (new_cleaned[ i ] !== undefined && datasource.encoders[ header ] && datasource.encoders[ header ][ new_cleaned[ i ] ] !== undefined) {
              new_cleaned[ i ] = datasource.encoders[ header ][ new_cleaned[ i ] ];
            } else {
              new_cleaned[ i ] = datasource.encoder_counts[ header ];
            }
          }
          let explainability_result = (mlmodel.type === 'binary') ? runRandomForestPrediction.call(classifier, [ new_cleaned ]) : runRandomForestPredictionCategorical.call(classifier, [new_cleaned]);
          // if (runIndustryProcessing) explainability_result = generateProjectedResult(scoreanalysis, explainability_result);
          explainability_results[ header ] = explainability_result;
        }));
      }

      let single_ml_result = {
        inputs: ml_variables,
        original_prediction,
        prediction,
        digifi_score,
        industry: mlmodel.industry || null,
        decision_name: req.body.decision_name || `Case ${count}`,
        explainability_results,
        averages,
        model_name: mlmodel.display_name,
        provider: 'random_forest',
        decoder: datasource.decoders,
        processing_type: 'individual',
        mlmodel: mlmodel._id ? mlmodel._id.toString() : null,
        model_type: mlmodel.type,
        user: user._id.toString(),
        organization,
        case_number: '',
      };
      return single_ml_result;
    } else {
      return null;
    }
  } catch (e) {
    logger.warn('Error in runSingleSagemakerLL', e);
    return e;
  }
}


function normalize(min, max) {
  const delta = max - min;
  return function (val) {
    let scaled = (val - min) / delta;
    if (scaled > 1) scaled = 1;
    if (scaled < 0) scaled = 0;
    return scaled;
  };
}

async function runSingleNeuralNetwork(req) {
  try {
    if (req.controllerData.mlmodel && req.controllerData.mlmodel.neural_network) {
      let explainability_results = {};
      const Mlcase = periodic.datas.get('standard_mlcase');
      let user = req.user;
      let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
      let mlmodel = req.controllerData.mlmodel;
      const scoreanalysis = req.controllerData.scoreanalysis;
      const runIndustryProcessing = mlmodel.industry && scoreanalysis && scoreanalysis.results && scoreanalysis.results.projection_evaluator;
      let provider = req.controllerData.mlmodel.neural_network;
      let datasource = mlmodel.datasource;
      let statistics = datasource.statistics;
      let ml_input_schema = datasource.included_columns || datasource.strategy_data_schema;
      let strategy_data_schema = JSON.parse(ml_input_schema);
      let transformations = datasource.transformations;
      let provider_datasource = datasource.providers.digifi;
      const column_scale = provider.column_scale;
      let datasource_headers = provider_datasource.headers.filter(header => header !== 'historical_result');
      let unflattenedReqBody = require('flat').unflatten(req.body);
      let ml_variables = {};
      let features = datasource_headers.map((hd, idx) => {
        ml_variables[ hd ] = (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined) ? unflattenedReqBody.inputs[ hd ] : '';
        return (unflattenedReqBody.inputs && unflattenedReqBody.inputs[ hd ] !== undefined && typeof unflattenedReqBody.inputs[ hd ] === 'string')
          ? transformhelpers.filterCSVSpecialCharacters(unflattenedReqBody.inputs[ hd ], true)
          : (unflattenedReqBody.inputs)
            ? unflattenedReqBody.inputs[ hd ]
            : '';
      });
      let columnTypes = {};
      for (let [ key, val, ] of Object.entries(strategy_data_schema)) {
        columnTypes[ key ] = val.data_type;
      }
      let transposed_rows = formatDataTypeColumns({ columnTypes, csv_headers: datasource_headers, rows: [ features ] });
      let hot_encoded = oneHotEncodeValues({ transposed_rows, columnTypes, encoders: datasource.encoders, decoders: datasource.decoders, encoder_counts: datasource.encoder_counts, csv_headers: datasource_headers, })
      let cleaned = hot_encoded.map((column, idx) => {
        let header = datasource_headers[ idx ];
        let mean = statistics[ header ].mean;
        return column.map(elmt => isNaN(parseFloat(elmt)) ? mean : elmt);
      });
      if (columnTypes[ 'historical_result' ] === 'Boolean' || columnTypes[ 'historical_result' ] === 'Number') {
        cleaned = cleaned.map((column, idx) => {
          let header = datasource_headers[ idx ];
          if (columnTypes[ header ] === 'Number' && transformations[ header ] && transformations[ header ].evaluator) {
            let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
            return column.map(applyTransformFunc);
          } else {
            return column;
          }
        });
      }
      cleaned = mathjs.transpose(cleaned)[ 0 ];
      cleaned = cleaned.map((col, idx) => {
        let { min, max } = column_scale[ datasource_headers[ idx ] ];
        col = normalize(min, max)(col);
        return col;
      });
      const model_config = provider.model;
      let classifier;
      eval(`classifier= ${model_config}`);
      let prediction = classifier(cleaned);
      let original_prediction = null;
      let digifi_score = null;
      if (mlmodel.type === 'binary') {
        if (runIndustryProcessing) {
          original_prediction = prediction['true'];
          digifi_score = mapPredictionToDigiFiScore(prediction['true']);
          prediction = generateProjectedResult(scoreanalysis, prediction[ 'true' ]);
        } else {
          prediction = prediction[ 'true' ];
        }
      } else if (mlmodel.type === 'categorical') {
        prediction = Object.keys(prediction).reduce((arr, key) => {
          arr[ Number(key) ] = prediction[ key ];
          return arr;
        }, []);
      }
      let count = await getCollectionCounter('standard_mlcase');
      let run_explainability = false;
      if (req.processing_type && req.processing_type === 'batch') {
        run_explainability = req.return_top_contributors || false;
      } else {
        run_explainability = (req.body && req.body.client_id && !req.body.return_top_contributors) ? false : true;
      }
      let averages = {};
      if (run_explainability) {
        await Promise.all(datasource_headers.map(async (header, i) => {
          let new_cleaned = cleaned.slice();
          if (strategy_data_schema[ header ] && strategy_data_schema[ header ].data_type === 'Number') {
            new_cleaned[ i ] = (statistics[ header ] && statistics[ header ].mean !== undefined) ? statistics[ header ].mean : null;
            averages[ header ] = new_cleaned[ i ];
            if (transformations && transformations[ header ] && transformations[ header ].evaluator) {
              let applyTransformFunc = new Function('x', transformations[ header ].evaluator);
              new_cleaned[ i ] = applyTransformFunc(new_cleaned[ i ]);
            }
            let { min, max } = column_scale[ datasource_headers[ i ] ];
            new_cleaned[ i ] = normalize(min, max)(new_cleaned[ i ]);
          } else if (strategy_data_schema[ header ] && (strategy_data_schema[ header ].data_type === 'String' || strategy_data_schema[ header ].data_type === 'Boolean') && statistics[ header ].mode !== undefined) {
            new_cleaned[ i ] = statistics[ header ].mode || null;
            averages[ header ] = new_cleaned[ i ];
            if (new_cleaned[ i ] !== undefined && datasource.encoders[ header ] && datasource.encoders[ header ][ new_cleaned[ i ] ] !== undefined) {
              new_cleaned[ i ] = datasource.encoders[ header ][ new_cleaned[ i ] ];
            } else {
              new_cleaned[ i ] = datasource.encoder_counts[ header ];
            }
            let { min, max } = column_scale[ datasource_headers[ i ] ];
            new_cleaned[ i ] = normalize(min, max)(new_cleaned[ i ]);
          }
          let explainability_result = classifier(new_cleaned);
          if (mlmodel.type === 'binary') {
            explainability_result = !isNaN(parseFloat(explainability_result[ 'true' ])) ? explainability_result[ 'true' ] : 1 - explainability_result[ 'false' ];
            // if (runIndustryProcessing) explainability_result = generateProjectedResult(scoreanalysis, explainability_result);
          } else if (mlmodel.type === 'categorical') {
            explainability_result = Object.keys(explainability_result).reduce((arr, key) => {
              arr[ Number(key) ] = explainability_result[ key ];
              return arr;
            }, []);
          }
          explainability_results[ header ] = explainability_result;
        }));
      }
      let single_ml_result = {
        inputs: ml_variables,
        industry: mlmodel.industry || null,
        original_prediction,
        prediction,
        digifi_score,
        decision_name: req.body.decision_name || `Case ${count}`,
        explainability_results,
        averages,
        model_name: mlmodel.display_name,
        provider: 'neural_network',
        decoder: datasource.decoders,
        processing_type: 'individual',
        mlmodel: mlmodel._id ? mlmodel._id.toString() : null,
        model_type: mlmodel.type,
        user: user._id.toString(),
        organization,
        case_number: '',
      };
      return single_ml_result;
    } else {
      return null;
    }
  } catch (e) {
    logger.warn('Error in runSingleNeuralNetwork', e);
    return e;
  }
}


module.exports = {
  aws: runSingleAWSMachineLearning,
  sagemaker_ll: runSingleSagemakerLL,
  sagemaker_xgb: runSingleSagemakerXGB,
  decision_tree: runSingleDecisionTree,
  random_forest: runSingleRandomForest,
  neural_network: runSingleNeuralNetwork,
};