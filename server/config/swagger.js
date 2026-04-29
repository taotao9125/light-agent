import swaggerJSDoc from 'swagger-jsdoc';


const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Express.js Bookstore API',
      version: '1.0.0',
      description: 'API documentation for the Express.js Bookstore application'
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['../server/modules/**/*.js']
}

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;